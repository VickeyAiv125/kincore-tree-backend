/**
 * KCC ID login for Kincore (client_id: kincore).
 * Unlike Google/Facebook, KCC ID uses credential POST (or PKCE), not a browser redirect OAuth.
 */
import {
    createSessionForEmail,
    ensureUserFromGoogleProfile as ensureUserFromSocialProfile
} from './googleAuthService.js';
import { AuthService } from './authService.js';

const trim = (v) => String(v || '').trim();

const firstText = (...values) => {
    for (const value of values) {
        const clean = trim(value);
        if (clean) return clean;
    }
    return '';
};

const HANDLER_KEYS = ['handler', 'handle', 'wallet_handle', 'preferred_username', 'username', 'kcc_id', 'kccid', 'kcc_handler', 'user_handle'];

/** A KCC handler is a username, never an email. A leading @ is optional. */
const normalizeHandler = (value) => {
    const clean = trim(value).replace(/^@+/, '');
    if (!clean || clean.includes('@') || /\s/.test(clean)) return '';
    return clean;
};

const decodeJwtPayload = (token) => {
    try {
        const part = String(token || '').split('.')[1];
        if (!part) return null;
        const parsed = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const flattenBags = (roots) => {
    const bags = [];
    const visit = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 3 || bags.includes(node)) return;
        bags.push(node);
        for (const value of Object.values(node)) {
            if (value && typeof value === 'object' && !Array.isArray(value)) visit(value, depth + 1);
        }
    };
    for (const root of roots) visit(root, 0);
    return bags;
};

/** KCC ID username. Userinfo and the ID token use `handler`; older payloads use handle / preferred_username. */
const readKccHandler = (roots, typedId) => {
    for (const bag of flattenBags(roots)) {
        for (const key of HANDLER_KEYS) {
            const handler = normalizeHandler(bag[key]);
            if (handler) return handler;
        }
    }
    return normalizeHandler(typedId);
};

const readKccEmail = (roots, typedId) => {
    for (const bag of flattenBags(roots)) {
        const email = firstText(bag.email, bag.email_address).toLowerCase();
        if (email.includes('@')) return email;
    }
    const typed = trim(typedId).toLowerCase();
    return typed.includes('@') ? typed : '';
};

const resolveStoredEmail = async (handler) => {
    const handle = normalizeHandler(handler).toLowerCase();
    if (!handle) return '';
    const { supabase } = await import('../config/supabaseClient.js');
    const { data, error } = await supabase
        .from('users')
        .select('email')
        .ilike('wallet_handle', handle)
        .maybeSingle();
    if (error) {
        console.warn('[KCC_LOGIN] handler lookup skipped:', error.message);
        return '';
    }
    const email = trim(data?.email).toLowerCase();
    return email.includes('@') ? email : '';
};

export const getKccClientConfig = () => {
    const baseUrl = trim(process.env.KCC_ID_BASE_URL || 'https://uat-auth.bigkpay.com').replace(/\/$/, '');
    const clientId = trim(process.env.KCC_CLIENT_ID || 'kincore');
    return { baseUrl, clientId };
};

/**
 * Login via KCC ID → ensure local user → mint Kincore session.
 */
export const loginWithKccId = async ({ identifier, password, skipLocalFallback = false }) => {
    const cleanId = trim(identifier);
    const cleanPass = String(password || '');
    if (!cleanId || !cleanPass) {
        throw new Error('Email/username and password are required for KCC ID login');
    }

    const { baseUrl, clientId } = getKccClientConfig();

    const postKccLogin = async (idForKcc) => {
        const res = await fetch(`${baseUrl}/kccid/v1/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({
                identifier: idForKcc,
                password: cleanPass,
                client_id: clientId,
                scope: 'openid profile email'
            })
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
    };

    // KCC ID login accepts an email. A handler (for example skker) is resolved to the
    // email saved from a previous KCC userinfo response, then sent as the identifier.
    const attempts = [cleanId];
    const mappedEmail = cleanId.includes('@') ? '' : await resolveStoredEmail(cleanId);
    if (mappedEmail && mappedEmail !== cleanId.toLowerCase()) attempts.push(mappedEmail);

    let loginRes;
    let loginData = {};
    let usedIdentifier = cleanId;
    for (const candidate of attempts) {
        const attempt = await postKccLogin(candidate);
        loginRes = attempt.res;
        loginData = attempt.data;
        usedIdentifier = candidate;
        if (loginRes.ok || loginRes.status === 429) break;
        if (candidate !== cleanId) {
            console.log('[KCC_LOGIN] handler was not accepted, retried with the stored email');
        }
    }

    if (!loginRes.ok) {
        // Local Kincore admins (auditor@admin.com, etc.) are not KCC ID users.
        // If ecosystem login fails, try the same email/password on Kincore.
        if (!skipLocalFallback) {
            try {
                const local = await AuthService.login({ identifier: cleanId, password: cleanPass });
                return {
                    ...local,
                    kcc: null,
                    login_via: 'kincore_local'
                };
            } catch {
                /* fall through to KCC error */
            }
        }
        const msg =
            loginData.error_description
            || loginData.message
            || loginData.error
            || 'KCC ID login failed';
        const err = new Error(
            typeof msg === 'string' && msg !== 'invalid_grant'
                ? msg
                : 'KCC ID did not accept these credentials. Use a KCC ID account, or sign in with Email / username for Kincore admin accounts such as auditor@admin.com.'
        );
        err.status = loginRes.status;
        err.payload = loginData;
        throw err;
    }

    // Wallet-style 2FA is usually skipped for client_id=kincore, but handle if returned
    if (loginData.requires_2fa || loginData['2fa_required']) {
        const err = new Error(loginData.message || 'Two-factor authentication required for this KCC account.');
        err.status = 401;
        err.requires_2fa = true;
        err.challenge_token = loginData.challenge_token;
        throw err;
    }

    const accessToken = loginData.access_token || loginData.token;
    if (!accessToken) {
        throw new Error('KCC ID did not return an access token');
    }

    const tokenClaims = {
        ...(decodeJwtPayload(accessToken) || {}),
        ...(decodeJwtPayload(loginData.id_token) || {})
    };
    let info = null;

    try {
        const infoRes = await fetch(`${baseUrl}/kccid/v1/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
        });
        if (infoRes.ok) info = await infoRes.json();
    } catch (e) {
        console.warn('[KCC_LOGIN] userinfo failed, continuing with identifier:', e.message);
    }

    const sources = [tokenClaims, loginData.user, loginData.profile, info].filter(Boolean);
    const handler = readKccHandler(sources, cleanId);
    const email = readKccEmail(sources, usedIdentifier) || mappedEmail;
    const name = firstText(
        info?.name,
        info?.full_name,
        tokenClaims.name,
        tokenClaims.preferred_username,
        handler
    );
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const profile = {
        sub: firstText(info?.sub, info?.id, tokenClaims.sub) || null,
        email,
        handler,
        emailVerified: info?.email_verified !== false && tokenClaims.email_verified !== false,
        firstName: firstText(info?.given_name, info?.first_name, tokenClaims.given_name, parts[0]),
        lastName: firstText(info?.family_name, info?.last_name, tokenClaims.family_name, parts.slice(1).join(' ')),
        fullName: name,
        avatarUrl: info?.picture || info?.avatar_url || tokenClaims.picture || null,
        provider: 'kcc',
        wallet_id: info?.wallet_id || tokenClaims.wallet_id || null,
        kcc_role: info?.role || tokenClaims.role || null
    };

    if (!profile.email || !profile.email.includes('@')) {
        throw new Error('KCC ID account has no email. Use an email-linked KCC account.');
    }

    const ensured = await ensureUserFromSocialProfile(profile);
    // Keep the KCC password on the local account so email/password login accepts it too.
    if (ensured?.userId && cleanPass) {
        try {
            const { supabase } = await import('../config/supabaseClient.js');
            const { error: passErr } = await supabase.auth.admin.updateUserById(ensured.userId, {
                password: cleanPass,
                email_confirm: true
            });
            if (passErr) console.warn('[KCC_LOGIN] local password sync skipped:', passErr.message);
        } catch (e) {
            console.warn('[KCC_LOGIN] local password sync skipped:', e.message);
        }
    }
    const session = await createSessionForEmail(profile.email);

    // Keep the KCC handler even when the user signed in with an email.
    if (profile.email && profile.handler) {
        try {
            const { supabase } = await import('../config/supabaseClient.js');
            await supabase
                .from('users')
                .update({ wallet_handle: profile.handler.toLowerCase() })
                .ilike('email', profile.email);
        } catch (e) {
            console.warn('[KCC_LOGIN] wallet_handle sync skipped:', e.message);
        }
    }

    const result = await AuthService.oauthLogin({
        access_token: session.access_token,
        provider: 'kcc',
        client_type: 'web',
        allow_signup: true
    });

    return {
        ...result,
        kcc: {
            access_token: accessToken,
            refresh_token: loginData.refresh_token || null,
            expires_in: loginData.expires_in || null,
            client_id: clientId,
            wallet_id: profile.wallet_id || null
        }
    };
};
