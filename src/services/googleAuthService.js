/**
 * Google OAuth (SSO) helpers for Kincore signup/login.
 * Client secret stays server-side only.
 */
import crypto from 'crypto';
import { supabase } from '../config/supabaseClient.js';

const STATE_TTL_MS = 10 * 60 * 1000;
const pendingStates = new Map();

const pruneStates = () => {
    const now = Date.now();
    for (const [key, meta] of pendingStates.entries()) {
        if (now - meta.createdAt > STATE_TTL_MS) pendingStates.delete(key);
    }
};

const trimEnv = (value) => String(value || '').trim();

export const getGoogleClientConfig = () => {
    const clientId = trimEnv(process.env.GOOGLE_CLIENT_ID);
    const clientSecret = trimEnv(process.env.GOOGLE_CLIENT_SECRET);
    const port = process.env.PORT || 5000;
    const backendPublic = trimEnv(process.env.BACKEND_URL || `http://localhost:${port}`).replace(/\/$/, '');
    const redirectUri = (
        trimEnv(process.env.GOOGLE_REDIRECT_URI)
        || `${backendPublic}/api/auth/google/callback`
    ).replace(/\/$/, '');
    const frontendUrl = trimEnv(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

    if (!clientId || !clientSecret) {
        throw new Error('Google SSO is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env');
    }

    return { clientId, clientSecret, redirectUri, frontendUrl };
};

export const createGoogleOAuthState = (meta = {}) => {
    pruneStates();
    const state = crypto.randomBytes(24).toString('hex');
    pendingStates.set(state, { createdAt: Date.now(), ...meta });
    return state;
};

export const consumeGoogleOAuthState = (state) => {
    pruneStates();
    if (!state || !pendingStates.has(state)) return null;
    const meta = pendingStates.get(state);
    pendingStates.delete(state);
    return meta;
};

export const buildGoogleAuthorizeUrl = ({ state }) => {
    const { clientId, redirectUri } = getGoogleClientConfig();
    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'online',
        prompt: 'select_account',
        state
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

export const exchangeGoogleCode = async (code) => {
    const { clientId, clientSecret, redirectUri } = getGoogleClientConfig();

    const body = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    });

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
        throw new Error(tokenData.error_description || tokenData.error || 'Google token exchange failed');
    }

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const profile = await userRes.json();
    if (!userRes.ok) {
        throw new Error(profile.error_description || profile.error || 'Failed to load Google profile');
    }

    if (!profile.email) {
        throw new Error('Google account did not return an email address');
    }

    return {
        accessToken: tokenData.access_token,
        idToken: tokenData.id_token,
        profile: {
            sub: profile.sub,
            email: String(profile.email).trim().toLowerCase(),
            emailVerified: profile.email_verified !== false,
            firstName: profile.given_name || '',
            lastName: profile.family_name || '',
            fullName: profile.name || '',
            avatarUrl: profile.picture || null
        }
    };
};

/**
 * Find or create Supabase Auth + public.users rows for a Google profile.
 */
export const ensureUserFromGoogleProfile = async (profile) => {
    const email = profile.email;
    const firstName = profile.firstName || (profile.fullName || '').split(' ')[0] || '';
    const lastName = profile.lastName || (profile.fullName || '').split(' ').slice(1).join(' ') || '';

    // Prefer existing app user by email
    const { data: existingAppUser } = await supabase
        .from('users')
        .select('*')
        .ilike('email', email)
        .maybeSingle();

    let userId = existingAppUser?.id || null;

    if (!userId) {
        // Try auth admin lookup (available on newer supabase-js)
        try {
            if (typeof supabase.auth.admin.getUserByEmail === 'function') {
                const { data: byEmail } = await supabase.auth.admin.getUserByEmail(email);
                userId = byEmail?.user?.id || null;
            }
        } catch {
            // ignore — fall through to create
        }
    }

    if (!userId) {
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
            email,
            email_confirm: true,
            user_metadata: {
                first_name: firstName,
                last_name: lastName,
                full_name: profile.fullName || `${firstName} ${lastName}`.trim(),
                avatar_url: profile.avatarUrl,
                provider: profile.provider || 'google',
                ...(profile.provider === 'facebook'
                    ? { facebook_sub: profile.sub }
                    : { google_sub: profile.sub })
            }
        });

        if (createErr) {
            // Already exists in Auth — recover via listUsers page scan by email
            if (/already|registered|exists/i.test(createErr.message || '')) {
                const { data: listed } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
                const match = (listed?.users || []).find((u) => String(u.email || '').toLowerCase() === email);
                if (!match) throw createErr;
                userId = match.id;
            } else {
                throw createErr;
            }
        } else {
            userId = created.user.id;
        }
    }

    // Upsert public users row
    const { data: appUser } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();
    if (!appUser) {
        const { data: inserted, error: insertErr } = await supabase
            .from('users')
            .insert({
                id: userId,
                email,
                first_name: firstName || null,
                last_name: lastName || null,
                avatar_url: profile.avatarUrl,
                status: 'active',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
        if (insertErr) {
            // Unique email conflict with different id — attach to existing row email
            const { data: byEmail } = await supabase.from('users').select('*').ilike('email', email).maybeSingle();
            if (byEmail) {
                return { userId: byEmail.id, email, isNew: false, appUser: byEmail };
            }
            throw insertErr;
        }
        return { userId, email, isNew: true, appUser: inserted };
    }

    // Soft-update profile fields if empty
    const updates = {};
    if (!appUser.first_name && firstName) updates.first_name = firstName;
    if (!appUser.last_name && lastName) updates.last_name = lastName;
    if (!appUser.avatar_url && profile.avatarUrl) updates.avatar_url = profile.avatarUrl;
    if (Object.keys(updates).length) {
        await supabase.from('users').update(updates).eq('id', userId);
    }

    return { userId, email, isNew: false, appUser };
};

/**
 * Mint a Supabase session for an existing auth user (server-side).
 */
export const createSessionForEmail = async (email) => {
    const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email
    });
    if (linkError) throw linkError;

    const tokenHash = linkData?.properties?.hashed_token;
    if (!tokenHash) {
        throw new Error('Could not mint auth session for social SSO');
    }

    const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'email'
    });
    if (otpError) throw otpError;
    if (!otpData?.session?.access_token) {
        throw new Error('Social SSO session could not be established');
    }

    return otpData.session;
};
