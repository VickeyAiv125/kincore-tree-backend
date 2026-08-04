/**
 * Resolve OAuth redirect targets for web admin vs mobile/web app clients.
 */

const trim = (value) => String(value || '').trim().replace(/\/$/, '');

const parseOrigin = (url) => {
    try {
        const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        return new URL(normalized).origin;
    } catch {
        return null;
    }
};

export const getAllowedOAuthOrigins = () => {
    const origins = new Set();
    const add = (value) => {
        const origin = parseOrigin(value);
        if (origin) origins.add(origin);
    };

    add(process.env.FRONTEND_URL);
    add(process.env.APP_URL);
    add(process.env.MOBILE_WEB_URL);
    add('http://localhost:5173');
    add('http://localhost:5000');

    String(process.env.OAUTH_REDIRECT_ORIGINS || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach(add);

    return origins;
};

export const parseOAuthStartQuery = (query = {}) => {
    const clientType = String(query.client_type || 'web').toLowerCase() === 'app' ? 'app' : 'web';
    const redirectTo = query.redirect_to || query.redirect_uri || null;
    return {
        mode: String(query.mode || 'login'),
        clientType,
        redirectTo: redirectTo ? String(redirectTo).trim() : null
    };
};

export const resolveOAuthRedirectBase = ({ clientType, redirectTo }) => {
    const webFrontend = trim(process.env.FRONTEND_URL || 'http://localhost:5173');
    const appDefault = trim(
        process.env.APP_URL
        || process.env.MOBILE_WEB_URL
        || 'https://kincore-tree.netlify.app'
    );
    const allowed = getAllowedOAuthOrigins();

    if (clientType !== 'app') {
        return `${webFrontend}/auth/callback`;
    }

    const candidate = redirectTo || appDefault;
    const origin = parseOrigin(candidate);
    if (!origin || !allowed.has(origin)) {
        return appDefault;
    }

    return candidate;
};

export const appendOAuthQuery = (baseUrl, params = {}) => {
    const entries = Object.entries(params).filter(([, value]) => value != null && value !== '');
    if (!entries.length) return baseUrl;

    const qs = new URLSearchParams(entries).toString();
    const hashIdx = baseUrl.indexOf('#');

    if (hashIdx >= 0) {
        const before = baseUrl.slice(0, hashIdx);
        const hashPart = baseUrl.slice(hashIdx);
        const sep = hashPart.includes('?') ? '&' : '?';
        return `${before}${hashPart}${sep}${qs}`;
    }

    const sep = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${sep}${qs}`;
};

export const buildOAuthCallbackRedirect = ({ clientType, redirectTo, params = {}, error }) => {
    const base = resolveOAuthRedirectBase({ clientType, redirectTo });
    if (error) {
        return appendOAuthQuery(base, { error });
    }
    return appendOAuthQuery(base, params);
};
