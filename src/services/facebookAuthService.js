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

const trimEnv = (value) => String(value || '').trim();

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
        auth_type: 'rerequest'
    });
    return `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth?${params.toString()}`;
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
        const msg = tokenData.error?.message || tokenData.error_description || 'Facebook token exchange failed';
        throw new Error(msg);
    }

    const fields = 'id,name,email,first_name,last_name,picture.type(large)';
    const profileRes = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(tokenData.access_token)}`
    );
    const profile = await profileRes.json();
    if (!profileRes.ok || profile.error) {
        throw new Error(profile.error?.message || 'Failed to load Facebook profile');
    }

    if (!profile.email) {
        throw new Error(
            'Facebook did not share an email. Grant email permission, or use a Facebook account with a verified email.'
        );
    }

    return {
        accessToken: tokenData.access_token,
        profile: {
            sub: String(profile.id),
            email: String(profile.email).trim().toLowerCase(),
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
