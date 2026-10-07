/**
 * Facebook / Meta OAuth helpers for Kincore signup/login.
 * App secret stays server-side only.
 */
import crypto from 'crypto';
import {
    createSessionForEmail,
    ensureUserFromGoogleProfile as ensureUserFromSocialProfile
} from './googleAuthService.js';

const GRAPH_VERSION = 'v21.0';
const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map();

const pruneStates = () => {
    const now = Date.now();
    for (const [key, meta] of pendingStates.entries()) {
        if (now - meta.createdAt > STATE_TTL_MS) pendingStates.delete(key);
    }
};

const trimEnv = (value) =>
    String(value || '').trim().replace(/^['"]+|['"]+$/g, '');

export const getFacebookClientConfig = () => {
    const appId = trimEnv(process.env.FACEBOOK_APP_ID || process.env.META_APP_ID);
    const appSecret = trimEnv(process.env.FACEBOOK_APP_SECRET || process.env.META_APP_SECRET);
    const port = process.env.PORT || 5000;
    const backendPublic = trimEnv(process.env.BACKEND_URL || `http://localhost:${port}`).replace(/\/$/, '');
    const redirectUri = (
        trimEnv(process.env.FACEBOOK_REDIRECT_URI)
        || `${backendPublic}/api/auth/facebook/callback`
    ).replace(/\/$/, '');
    const frontendUrl = trimEnv(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

    if (!appId || !appSecret) {
        throw new Error('Facebook SSO is not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in backend/.env');
    }

    return { appId, appSecret, redirectUri, frontendUrl };
};

export const createFacebookOAuthState = (meta = {}) => {
    pruneStates();
    const state = crypto.randomBytes(24).toString('hex');
    pendingStates.set(state, { createdAt: Date.now(), ...meta });
    return state;
};

export const consumeFacebookOAuthState = (state) => {
    pruneStates();
    if (!state || !pendingStates.has(state)) return null;
    const meta = pendingStates.get(state);
    pendingStates.delete(state);
    return meta;
};

export const buildFacebookAuthorizeUrl = ({ state }) => {
    const { appId, redirectUri } = getFacebookClientConfig();
    const params = new URLSearchParams({
        client_id: appId,
        redirect_uri: redirectUri,
        state,
        scope: 'email,public_profile',
        response_type: 'code',
        auth_type: 'rerequest',
        return_scopes: 'true'
    });
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
};

/** Stable login email when Meta grants email scope but Graph returns no address (phone-only / unconfirmed / Standard Access). */
export const facebookPlaceholderEmail = (facebookUserId) =>
    `fb_${String(facebookUserId).replace(/\D/g, '')}@facebook.oauth.kincore`;

const placeholderEmailEnabled = () => {
    const raw = trimEnv(process.env.FACEBOOK_PLACEHOLDER_EMAIL).toLowerCase();
    if (['0', 'false', 'no'].includes(raw)) return false;
    if (['1', 'true', 'yes'].includes(raw)) return true;
    // UAT: Meta often grants email scope but returns no address without Advanced Access.
    return trimEnv(process.env.BACKEND_URL).includes('uat-api.kincore.com');
};

const facebookEmailHelpMessage = async (accessToken) => {
    let emailPermGranted = false;
    try {
        const res = await fetch(
            `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions?access_token=${encodeURIComponent(accessToken)}`
        );
        const data = await res.json();
        const perms = Array.isArray(data?.data) ? data.data : [];
        const emailPerm = perms.find((p) => p.permission === 'email');
        if (emailPerm?.status === 'declined') {
            return (
                'Email permission was declined. Remove Kincore under Facebook Settings → Apps and websites, ' +
                'then try Facebook login again and tap Allow for email.'
            );
        }
        emailPermGranted = emailPerm?.status === 'granted';
    } catch (_) {
        /* ignore permission probe errors */
    }
    if (emailPermGranted) {
        return (
            'Facebook did not share an email. Confirm the primary email on your Facebook account, or in Meta Developer ' +
            'Console enable Advanced Access for the email permission (App Review). You can also sign in with Google or email/password.'
        );
    }
    return (
        'Facebook did not share an email. Use a Facebook account with a verified email, allow email when prompted, ' +
        'or sign in with Google or email/password.'
    );
};

const resolveFacebookLoginEmail = async ({ profile, accessToken }) => {
    if (profile.email) {
        return String(profile.email).trim().toLowerCase();
    }
    const facebookId = profile.id;
    if (!facebookId) {
        const help = await facebookEmailHelpMessage(accessToken);
        throw new Error(help);
    }
    if (placeholderEmailEnabled()) {
        return facebookPlaceholderEmail(facebookId);
    }
    const help = await facebookEmailHelpMessage(accessToken);
    throw new Error(help);
};

export const exchangeFacebookCode = async (code) => {
    const { appId, appSecret, redirectUri } = getFacebookClientConfig();

    const tokenParams = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code
    });

    const tokenRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token?${tokenParams.toString()}`
    );
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
        const raw = tokenData.error?.message || tokenData.error_description || tokenData.error || 'Facebook token exchange failed';
        if (String(raw).toLowerCase().includes('invalid_grant') || tokenData.error?.code === 100) {
            throw new Error(
                'Facebook sign-in expired or was already used. Close the browser, open the Kincore app, and tap Facebook again (do not refresh the login page).'
            );
        }
        throw new Error(raw);
    }

    const fields = 'id,name,email,first_name,last_name,picture.type(large)';
    const profileRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(tokenData.access_token)}`
    );
    const profile = await profileRes.json();
    if (!profileRes.ok || profile.error) {
        throw new Error(profile.error?.message || 'Failed to load Facebook profile');
    }

    const email = await resolveFacebookLoginEmail({
        profile,
        accessToken: tokenData.access_token
    });

    return {
        accessToken: tokenData.access_token,
        profile: {
            sub: String(profile.id),
            email,
            emailVerified: true,
            firstName: profile.first_name || '',
            lastName: profile.last_name || '',
            fullName: profile.name || '',
            avatarUrl: profile.picture?.data?.url || null,
            provider: 'facebook'
        }
    };
};

export { createSessionForEmail, ensureUserFromSocialProfile };
