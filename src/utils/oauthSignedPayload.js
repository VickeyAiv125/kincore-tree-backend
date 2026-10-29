import crypto from 'crypto';

const trimEnv = (value) =>
    String(value || '').trim().replace(/^['"]+|['"]+$/g, '');

export const oauthSigningSecret = () =>
    trimEnv(process.env.OAUTH_STATE_SECRET)
    || trimEnv(process.env.JWT_SECRET)
    || trimEnv(process.env.SUPABASE_JWT_SECRET)
    || trimEnv(process.env.FACEBOOK_APP_SECRET)
    || trimEnv(process.env.GOOGLE_CLIENT_SECRET)
    || '';

/**
 * Compact signed blob for OAuth state, pending steps, and app handoff tickets.
 * Works across API restarts without a shared filesystem.
 */
export const signOAuthPayload = (payload, ttlMs) => {
    const secret = oauthSigningSecret();
    if (!secret) return null;
    const exp = Date.now() + Math.max(Number(ttlMs) || 0, 60_000);
    const body = { ...payload, exp };
    const b64 = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
    return `${b64}.${sig}`;
};

export const verifyOAuthPayload = (token) => {
    const secret = oauthSigningSecret();
    if (!secret || !token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [b64, sig] = parts;
    if (!b64 || !sig) return null;
    const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
    try {
        const a = Buffer.from(sig, 'utf8');
        const b = Buffer.from(expected, 'utf8');
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    } catch {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
    if (!parsed?.exp || Date.now() > Number(parsed.exp)) return null;
    const { exp, ...rest } = parsed;
    return rest;
};
