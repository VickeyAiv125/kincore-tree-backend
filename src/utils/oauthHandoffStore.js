/**
 * OAuth handoff stored on disk so a restart does not drop Facebook linking
 * or the short sign-in ticket the app exchanges for a session.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const TTL_MS = 15 * 60 * 1000;
const FILE = process.env.OAUTH_STORE_PATH || '/tmp/kincore-oauth-store.json';

const empty = () => ({
    redirects: {},
    tickets: {},
    facebookStates: {},
    facebookPending: {}
});

const readAll = () => {
    try {
        const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return { ...empty(), ...parsed };
    } catch {
        return empty();
    }
};

const writeAll = (data) => {
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        const tmp = `${FILE}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, FILE);
    } catch (err) {
        console.warn('[OAUTH_STORE] persist skipped:', err.message);
    }
};

const pruneBucket = (bucket, now) => {
    for (const [key, row] of Object.entries(bucket || {})) {
        const at = row?.at || row?.createdAt || 0;
        if (!at || now - at > TTL_MS) delete bucket[key];
    }
};

const withStore = (mutator) => {
    const data = readAll();
    const now = Date.now();
    pruneBucket(data.redirects, now);
    pruneBucket(data.tickets, now);
    pruneBucket(data.facebookStates, now);
    pruneBucket(data.facebookPending, now);
    const result = mutator(data, now);
    writeAll(data);
    return result;
};

export const getCachedOAuthRedirectForCode = (code) => {
    const key = String(code || '').trim();
    if (!key) return null;
    return withStore((data) => data.redirects[key]?.redirectUrl || null);
};

export const cacheOAuthRedirectForCode = (code, redirectUrl) => {
    const key = String(code || '').trim();
    if (!key || !redirectUrl) return;
    withStore((data, now) => {
        data.redirects[key] = { redirectUrl, at: now };
    });
};

export const createOAuthHandoffTicket = ({ token, provider }) => {
    const ticket = crypto.randomBytes(18).toString('hex');
    withStore((data, now) => {
        data.tickets[ticket] = {
            token,
            provider: provider || 'google',
            at: now
        };
    });
    return ticket;
};

/** Reusable until expiry. The app calls oauth-login twice for one redirect. */
export const readOAuthHandoffTicket = (ticket) => {
    const key = String(ticket || '').trim();
    if (!key) return null;
    return withStore((data) => data.tickets[key] || null);
};

export const consumeOAuthHandoffTicket = readOAuthHandoffTicket;

export const saveFacebookOAuthState = (state, meta = {}) => {
    const key = String(state || '').trim();
    if (!key) return;
    withStore((data, now) => {
        data.facebookStates[key] = { ...meta, createdAt: now };
    });
};

export const consumeFacebookOAuthStateRecord = (state) => {
    const key = String(state || '').trim();
    if (!key) return null;
    return withStore((data) => {
        const meta = data.facebookStates[key] || null;
        if (meta) delete data.facebookStates[key];
        return meta;
    });
};

export const saveFacebookPending = (id, row) => {
    const key = String(id || '').trim();
    if (!key) return;
    withStore((data, now) => {
        data.facebookPending[key] = { ...row, createdAt: row.createdAt || now };
    });
};

export const readFacebookPending = (id) => {
    const key = String(id || '').trim();
    if (!key) return null;
    return withStore((data) => data.facebookPending[key] || null);
};

export const deleteFacebookPending = (id) => {
    const key = String(id || '').trim();
    if (!key) return;
    withStore((data) => {
        delete data.facebookPending[key];
    });
};
