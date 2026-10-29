/**
 * OAuth handoff stored on disk so a restart does not drop Facebook linking
 * or the short sign-in ticket the app exchanges for a session.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { signOAuthPayload, verifyOAuthPayload } from './oauthSignedPayload.js';

const TTL_MS = 15 * 60 * 1000;
const FACEBOOK_PENDING_TTL_MS = 2 * 60 * 60 * 1000;
const FILE = process.env.OAUTH_STORE_PATH || '/app/oauth-handoff/kincore-oauth-store.json';

const empty = () => ({
    redirects: {},
    tickets: {},
    googleStates: {},
    facebookStates: {},
    facebookPending: {},
    facebookPendingByEmail: {}
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

const rowAge = (row, now) => {
    const at = row?.updatedAt || row?.at || row?.createdAt || 0;
    if (!at) return Number.POSITIVE_INFINITY;
    return now - at;
};

const pruneBucket = (bucket, now, ttlMs = TTL_MS, exceptKeys = []) => {
    for (const [key, row] of Object.entries(bucket || {})) {
        if (exceptKeys.includes(key)) continue;
        if (rowAge(row, now) > ttlMs) delete bucket[key];
    }
};

const withStore = (mutator, options = {}) => {
    const data = readAll();
    const now = Date.now();
    const keepPending = options.keepPendingKeys || [];
    pruneBucket(data.redirects, now);
    pruneBucket(data.tickets, now);
    pruneBucket(data.googleStates, now);
    pruneBucket(data.facebookStates, now);
    pruneBucket(data.facebookPending, now, FACEBOOK_PENDING_TTL_MS, keepPending);
    pruneBucket(data.facebookPendingByEmail, now, FACEBOOK_PENDING_TTL_MS);
    const result = mutator(data, now);
    writeAll(data);
    return result;
};

const indexFacebookPendingEmail = (data, id, row, now) => {
    const email = String(row?.pendingEmail || row?.email || '').trim().toLowerCase();
    if (!email.includes('@')) return;
    data.facebookPendingByEmail[email] = { id, updatedAt: now };
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
    const signed = signOAuthPayload(
        { token, provider: provider || 'google' },
        TTL_MS
    );
    if (signed) return signed;

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

    const signed = verifyOAuthPayload(key);
    if (signed?.token) {
        return { token: signed.token, provider: signed.provider || 'google' };
    }

    return withStore((data) => data.tickets[key] || null);
};

export const consumeOAuthHandoffTicket = readOAuthHandoffTicket;

export const saveGoogleOAuthState = (state, meta = {}) => {
    const key = String(state || '').trim();
    if (!key) return;
    withStore((data, now) => {
        data.googleStates[key] = { ...meta, createdAt: now };
    });
};

export const consumeGoogleOAuthStateRecord = (state) => {
    const key = String(state || '').trim();
    if (!key) return null;

    const signed = verifyOAuthPayload(key);
    if (signed) return signed;

    return withStore((data) => {
        const meta = data.googleStates[key] || null;
        if (meta) delete data.googleStates[key];
        return meta;
    });
};

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

    const signed = verifyOAuthPayload(key);
    if (signed) return signed;

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
        const createdAt = row.createdAt || now;
        const next = { ...row, createdAt, updatedAt: now };
        data.facebookPending[key] = next;
        indexFacebookPendingEmail(data, key, next, now);
    });
};

export const readFacebookPending = (id) => {
    const key = String(id || '').trim();
    if (!key) return null;
    return withStore((data, now) => {
        const row = data.facebookPending[key];
        if (!row) return null;
        row.updatedAt = now;
        data.facebookPending[key] = row;
        indexFacebookPendingEmail(data, key, row, now);
        return row;
    }, { keepPendingKeys: [key] });
};

export const readFacebookPendingByEmail = (email) => {
    const clean = String(email || '').trim().toLowerCase();
    if (!clean.includes('@')) return null;
    const snapshot = readAll();
    const keepPendingKeys = snapshot.facebookPendingByEmail?.[clean]?.id
        ? [snapshot.facebookPendingByEmail[clean].id]
        : [];
    return withStore((data, now) => {
        const pointer = data.facebookPendingByEmail[clean];
        if (!pointer?.id) return null;
        const row = data.facebookPending[pointer.id];
        if (!row) {
            delete data.facebookPendingByEmail[clean];
            return null;
        }
        row.updatedAt = now;
        pointer.updatedAt = now;
        data.facebookPending[pointer.id] = row;
        data.facebookPendingByEmail[clean] = pointer;
        return { id: pointer.id, row };
    }, { keepPendingKeys });
};

export const deleteFacebookPending = (id) => {
    const key = String(id || '').trim();
    if (!key) return;
    withStore((data) => {
        const row = data.facebookPending[key];
        delete data.facebookPending[key];
        const email = String(row?.pendingEmail || row?.email || '').trim().toLowerCase();
        if (email && data.facebookPendingByEmail?.[email]?.id === key) {
            delete data.facebookPendingByEmail[email];
        }
    });
};
