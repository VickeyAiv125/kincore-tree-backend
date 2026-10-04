/**
 * In-memory OAuth handoff: idempotent callback redirects + short tickets for native apps.
 */
import crypto from 'crypto';

const TTL_MS = 10 * 60 * 1000;
const redirectByCode = new Map();
const ticketStore = new Map();

const prune = () => {
    const now = Date.now();
    for (const [key, meta] of redirectByCode.entries()) {
        if (now - meta.at > TTL_MS) redirectByCode.delete(key);
    }
    for (const [key, meta] of ticketStore.entries()) {
        if (now - meta.at > TTL_MS) ticketStore.delete(key);
    }
};

export const getCachedOAuthRedirectForCode = (code) => {
    prune();
    const key = String(code || '').trim();
    if (!key) return null;
    return redirectByCode.get(key)?.redirectUrl || null;
};

export const cacheOAuthRedirectForCode = (code, redirectUrl) => {
    prune();
    const key = String(code || '').trim();
    if (!key || !redirectUrl) return;
    redirectByCode.set(key, { redirectUrl, at: Date.now() });
};

export const createOAuthHandoffTicket = ({ token, provider }) => {
    prune();
    const ticket = crypto.randomBytes(18).toString('hex');
    ticketStore.set(ticket, {
        token,
        provider: provider || 'google',
        at: Date.now()
    });
    return ticket;
};

export const consumeOAuthHandoffTicket = (ticket) => {
    prune();
    const key = String(ticket || '').trim();
    if (!key || !ticketStore.has(key)) return null;
    const meta = ticketStore.get(key);
    ticketStore.delete(key);
    return meta;
};
