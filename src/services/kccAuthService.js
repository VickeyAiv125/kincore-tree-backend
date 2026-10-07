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

/** KCC ID username. Userinfo uses `handler`; older payloads use handle / preferred_username. */
const readKccHandler = (info, typedId) => {
    const bags = [info, info?.user, info?.data, info?.profile].filter((bag) => bag && typeof bag === 'object');
    for (const bag of bags) {
        const handler = firstText(
            bag.handler,
            bag.handle,
            bag.wallet_handle,
            bag.preferred_username,
            bag.username,
            bag.kcc_id,
            bag.kccid
        );
        if (handler && !handler.includes('@') && !handler.includes(' ')) return handler;
    }
    if (typedId && !typedId.includes('@') && !typedId.includes(' ')) return typedId;
    return '';
};

const readKccEmail = (info, typedId) => {
    const bags = [info, info?.user, info?.data, info?.profile].filter((bag) => bag && typeof bag === 'object');
    for (const bag of bags) {
        const email = firstText(bag.email, bag.email_address).toLowerCase();
        if (email.includes('@')) return email;
    }
    return typedId.includes('@') ? typedId.toLowerCase() : '';
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

    const loginRes = await fetch(`${baseUrl}/kccid/v1/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
            identifier: cleanId,
            password: cleanPass,
            client_id: clientId,
            scope: 'openid profile email'
        })
    });

    const loginData = await loginRes.json().catch(() => ({}));
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

    let profile = {
        sub: null,
        email: cleanId.includes('@') ? cleanId.toLowerCase() : '',
        handler: readKccHandler(null, cleanId),
        emailVerified: true,
        firstName: '',
        lastName: '',
        fullName: '',
        avatarUrl: null,
        provider: 'kcc'
    };

    try {
        const infoRes = await fetch(`${baseUrl}/kccid/v1/userinfo`, {
            headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
        });
        if (infoRes.ok) {
            const info = await infoRes.json();
            const name = firstText(info.name, info.full_name, info.preferred_username, profile.handler);
            const parts = String(name).trim().split(/\s+/).filter(Boolean);
            profile = {
                sub: info.sub || info.id || null,
                email: readKccEmail(info, cleanId),
                handler: readKccHandler(info, cleanId),
                emailVerified: info.email_verified !== false,
                firstName: firstText(info.given_name, info.first_name, parts[0]),
                lastName: firstText(info.family_name, info.last_name, parts.slice(1).join(' ')),
                fullName: name,
                avatarUrl: info.picture || info.avatar_url || null,
                provider: 'kcc',
                wallet_id: info.wallet_id || null,
                kcc_role: info.role || null
            };
        }
    } catch (e) {
        console.warn('[KCC_LOGIN] userinfo failed, continuing with identifier:', e.message);
    }

    if (!profile.email || !profile.email.includes('@')) {
        throw new Error('KCC ID account has no email. Use an email-linked KCC account.');
    }

    await ensureUserFromSocialProfile(profile);
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
