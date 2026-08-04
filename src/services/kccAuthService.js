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

export const getKccClientConfig = () => {
    const baseUrl = trim(process.env.KCC_ID_BASE_URL || 'https://auth.bigkpay.com').replace(/\/$/, '');
    const clientId = trim(process.env.KCC_CLIENT_ID || 'kincore');
    return { baseUrl, clientId };
};

/**
 * Login via KCC ID → ensure local user → mint Kincore session.
 */
export const loginWithKccId = async ({ identifier, password }) => {
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
        const msg =
            loginData.error_description
            || loginData.message
            || loginData.error
            || 'KCC ID login failed';
        const err = new Error(typeof msg === 'string' ? msg : 'KCC ID login failed');
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
        email: cleanId.includes('@') ? cleanId.toLowerCase() : null,
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
            const name = info.name || info.preferred_username || '';
            const parts = String(name).trim().split(/\s+/);
            profile = {
                sub: info.sub || null,
                email: String(info.email || profile.email || cleanId).trim().toLowerCase(),
                emailVerified: info.email_verified !== false,
                firstName: parts[0] || '',
                lastName: parts.slice(1).join(' ') || '',
                fullName: name,
                avatarUrl: info.picture || null,
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
