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
    add('https://uat.kincore.com');
    add('https://uat-app.kincore.com');
    add('https://uat-admin.kincore.com');

    String(process.env.OAUTH_REDIRECT_ORIGINS || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .forEach(add);

    return origins;
};

const normalizeClientType = (raw) => {
    const value = String(raw || 'web').toLowerCase().replace(/-/g, '_');
    if (value === 'app' || value === 'native') return 'app';
    if (value === 'mobile_web' || value === 'mobileweb' || value === 'flutter_web') {
        return 'mobile_web';
    }
    return 'web';
};

export const parseOAuthStartQuery = (query = {}) => {
    const redirectTo = query.redirect_to || query.redirect_uri || null;
    return {
        mode: String(query.mode || 'login'),
        clientType: normalizeClientType(query.client_type),
        redirectTo: redirectTo ? String(redirectTo).trim() : null
    };
};

const isCustomSchemeUrl = (url) =>
    url && /^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url);

const resolveAllowedHttpsRedirect = (redirectTo, allowed, fallback) => {
    if (!redirectTo || !/^https?:/i.test(redirectTo)) return null;
    const origin = parseOrigin(redirectTo);
    if (origin && allowed.has(origin)) {
        return redirectTo.replace(/\/$/, '');
    }
    return fallback.replace(/\/$/, '');
};

export const resolveOAuthRedirectBase = ({ clientType, redirectTo }) => {
    const webFrontend = trim(process.env.FRONTEND_URL || 'http://localhost:5173');
    const appDeepLinkDefault = trim(
        process.env.APP_OAUTH_REDIRECT || 'kincore://auth/callback'
    );
    const appWebDefault = trim(
        process.env.APP_URL
        || process.env.MOBILE_WEB_URL
        || 'https://uat-app.kincore.com'
    );
    const allowed = getAllowedOAuthOrigins();

    // Flutter web / mobile browser — never send users to kincore://
    if (clientType === 'mobile_web') {
        return resolveAllowedHttpsRedirect(redirectTo, allowed, appWebDefault)
            || appWebDefault.replace(/\/$/, '');
    }

    if (clientType === 'web') {
        return `${webFrontend}/auth/callback`;
    }

    // Native app: explicit HTTPS redirect_to (e.g. uat-app) wins over deep link
    const httpsTarget = resolveAllowedHttpsRedirect(redirectTo, allowed, null);
    if (httpsTarget) return httpsTarget;

    if (redirectTo && isCustomSchemeUrl(redirectTo)) {
        return redirectTo.replace(/\/$/, '');
    }

    if (redirectTo && /^https?:/i.test(redirectTo)) {
        // HTTPS requested but not allowlisted — stay on web app, not native deep link
        return appWebDefault.replace(/\/$/, '');
    }

    return (appDeepLinkDefault || appWebDefault).replace(/\/$/, '');
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
