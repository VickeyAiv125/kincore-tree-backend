/**
 * Facebook / Meta OAuth helpers for Kincore signup/login.
 * App secret stays server-side only.
 */
import crypto from 'crypto';
import {
    createSessionForEmail,
    ensureUserFromGoogleProfile as ensureUserFromSocialProfile
} from './googleAuthService.js';
import {
    consumeFacebookOAuthStateRecord,
    deleteFacebookPending,
    readFacebookPending,
    readFacebookPendingByEmail,
    saveFacebookOAuthState,
    saveFacebookPending
} from '../utils/oauthHandoffStore.js';
import { signOAuthPayload, verifyOAuthPayload } from '../utils/oauthSignedPayload.js';

const GRAPH_VERSION = 'v21.0';

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

const FACEBOOK_PENDING_TTL_MS = 2 * 60 * 60 * 1000;
const FACEBOOK_STATE_TTL_MS = 15 * 60 * 1000;

export const createFacebookOAuthState = (meta = {}) => {
    const signed = signOAuthPayload(
        { ...meta, nonce: crypto.randomBytes(12).toString('hex') },
        FACEBOOK_STATE_TTL_MS
    );
    if (signed) return signed;

    const state = crypto.randomBytes(24).toString('hex');
    saveFacebookOAuthState(state, meta);
    return state;
};

export const consumeFacebookOAuthState = (state) => consumeFacebookOAuthStateRecord(state);

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
    if (['1', 'true', 'yes'].includes(raw)) return true;
    // Default off: when Facebook omits email, collect and verify a real address first.
    return false;
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

    const email = String(profile.email || '').trim().toLowerCase();
    const usableEmail = isUsableFacebookEmail(email) ? email : '';

    return {
        accessToken: tokenData.access_token,
        profile: {
            sub: String(profile.id),
            email: usableEmail,
            emailVerified: Boolean(usableEmail),
            firstName: profile.first_name || '',
            lastName: profile.last_name || '',
            fullName: profile.name || '',
            avatarUrl: profile.picture?.data?.url || null,
            provider: 'facebook'
        }
    };
};

const isUsableFacebookEmail = (email) => {
    const value = String(email || '').trim().toLowerCase();
    if (!value.includes('@') || value.includes(' ')) return false;
    if (value.endsWith('@facebook.oauth.kincore')) return false;
    return true;
};

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
}[ch]));

const findAuthUserByFacebookSub = async (facebookSub) => {
    const { supabase } = await import('../config/supabaseClient.js');
    const target = String(facebookSub || '');
    if (!target) return null;
    for (let page = 1; page <= 10; page += 1) {
        const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const users = data?.users || [];
        const match = users.find((user) => String(user.user_metadata?.facebook_sub || '') === target);
        if (match) return match;
        if (users.length < 200) return null;
    }
    return null;
};

const findUserByEmail = async (email) => {
    const { supabase } = await import('../config/supabaseClient.js');
    const { data, error } = await supabase
        .from('users')
        .select('id, email')
        .ilike('email', email)
        .maybeSingle();
    if (error) throw error;
    return data || null;
};

const attachFacebookSub = async (userId, profile) => {
    const { supabase } = await import('../config/supabaseClient.js');
    const { data, error } = await supabase.auth.admin.getUserById(userId);
    if (error) throw error;
    const prev = data?.user?.user_metadata || {};
    const existing = String(prev.facebook_sub || '');
    if (existing && existing !== String(profile.sub)) {
        throw new Error('This account is already linked to a different Facebook account.');
    }
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
            ...prev,
            facebook_sub: String(profile.sub),
            first_name: prev.first_name || profile.firstName || '',
            last_name: prev.last_name || profile.lastName || '',
            avatar_url: prev.avatar_url || profile.avatarUrl || null
        }
    });
    if (updateError) throw updateError;
};

const issueFacebookSession = async ({ email, clientType, profile, userId }) => {
    const { AuthService } = await import('./authService.js');
    if (userId) await attachFacebookSub(userId, profile);
    await ensureUserFromSocialProfile({ ...profile, email, provider: 'facebook' });
    if (!userId) {
        const row = await findUserByEmail(email);
        if (row?.id) await attachFacebookSub(row.id, profile);
    }
    const session = await createSessionForEmail(email);
    const result = await AuthService.oauthLogin({
        access_token: session.access_token,
        provider: 'facebook',
        client_type: clientType === 'app' ? 'app' : 'web',
        allow_signup: true
    });
    return result.token;
};

/** Issue 7: linked → login; email matches unlinked KCC → confirm; none → register; no email → collect. */
export const decideFacebookAction = ({ linkedUser, profileEmail, existingUserByEmail }) => {
    const linkedEmail = String(linkedUser?.email || '').trim().toLowerCase();
    if (linkedUser?.id && linkedEmail.includes('@')) {
        return { action: 'login', email: linkedEmail, userId: linkedUser.id };
    }
    const email = String(profileEmail || '').trim().toLowerCase();
    if (!isUsableFacebookEmail(email)) {
        return { action: 'need_email' };
    }
    if (existingUserByEmail?.id) {
        return { action: 'confirm_link', email, userId: existingUserByEmail.id };
    }
    return { action: 'register', email };
};

const classifyFacebookProfile = async (profile) => {
    const linked = await findAuthUserByFacebookSub(profile.sub);
    const email = String(profile.email || '').trim().toLowerCase();
    const existing = isUsableFacebookEmail(email) ? await findUserByEmail(email) : null;
    return decideFacebookAction({
        linkedUser: linked,
        profileEmail: email,
        existingUserByEmail: existing
    });
};

const slimProfileForPending = (profile) => {
    if (!profile || typeof profile !== 'object') return profile;
    return {
        sub: profile.sub,
        email: profile.email || '',
        emailVerified: profile.emailVerified,
        firstName: profile.firstName || '',
        lastName: profile.lastName || '',
        fullName: profile.fullName || '',
        provider: profile.provider || 'facebook'
    };
};

const slimPendingForSign = (row) => {
    const next = { ...row };
    if (next.profile) next.profile = slimProfileForPending(next.profile);
    return next;
};

/** Disk backup so OTP verify survives long signed tokens / container restarts. */
const persistPendingBackup = (row) => {
    const email = String(row.pendingEmail || row.email || '').trim().toLowerCase();
    if (email.includes('@')) {
        const id = `fbmail:${crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
        saveFacebookPending(id, row);
        return id;
    }
    const sub = String(row.profile?.sub || '').trim();
    if (sub) {
        const id = `fbprof:${crypto.createHash('sha256').update(sub).digest('hex').slice(0, 32)}`;
        saveFacebookPending(id, row);
        return id;
    }
    return null;
};

const savePending = (row) => {
    const payload = { ...row, createdAt: Date.now() };
    persistPendingBackup(payload);
    const signed = signOAuthPayload(slimPendingForSign(payload), FACEBOOK_PENDING_TTL_MS);
    if (signed) return signed;

    const id = crypto.randomBytes(24).toString('hex');
    saveFacebookPending(id, payload);
    return id;
};

const readPending = (tokenOrId) => {
    const key = String(tokenOrId || '').trim();
    if (!key) return null;
    const signed = verifyOAuthPayload(key);
    if (signed) return signed;
    return readFacebookPending(key);
};

const writePending = (_tokenOrId, row) => {
    const payload = { ...row, updatedAt: Date.now() };
    persistPendingBackup(payload);
    const signed = signOAuthPayload(slimPendingForSign(payload), FACEBOOK_PENDING_TTL_MS);
    if (signed) return signed;

    const id = String(_tokenOrId || '').trim() || crypto.randomBytes(24).toString('hex');
    saveFacebookPending(id, payload);
    return id;
};

const stepPage = ({ title, intro, error, pendingId, hidden = {}, fields = '', submitLabel }) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f3f4f6; color: #111; }
    main { max-width: 420px; margin: 0 auto; padding: 28px 20px 40px; }
    h1 { font-size: 22px; margin: 0 0 8px; }
    p { color: #4b5563; font-size: 14px; line-height: 1.45; }
    label { display: block; font-size: 13px; font-weight: 700; margin: 14px 0 6px; }
    input { width: 100%; box-sizing: border-box; border: 0; border-radius: 14px; padding: 14px 16px; font-size: 16px; background: #fff; }
    button { width: 100%; margin-top: 18px; border: 0; border-radius: 999px; padding: 14px 16px; font-size: 15px; font-weight: 700; color: #fff; background: #ff6d4d; }
    .error { background: #fee2e2; color: #b91c1c; border-radius: 12px; padding: 12px 14px; font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <main>
    <h1>${esc(title)}</h1>
    <p>${esc(intro)}</p>
    ${error ? `<div class="error">${esc(error)}</div>` : ''}
    <form method="post" action="/api/auth/facebook/continue">
      <input type="hidden" name="pending_token" value="${esc(pendingId)}" />
      <input type="hidden" name="pending_id" value="${esc(pendingId)}" />
      ${Object.entries(hidden).map(([key, value]) => `<input type="hidden" name="${esc(key)}" value="${esc(value)}" />`).join('')}
      ${fields}
      <button type="submit">${esc(submitLabel)}</button>
    </form>
  </main>
</body>
</html>`;

const pageForPending = (pendingId, pending, error = '') => {
    if (pending.action === 'need_email') {
        return stepPage({
            title: 'Add your email',
            intro: 'Facebook did not share an email. Enter an email and verify it before completing registration or linking.',
            error,
            pendingId,
            hidden: { action: 'request_email' },
            fields: '<label>Email</label><input name="email" type="email" autocomplete="email" required />',
            submitLabel: 'Send verification code'
        });
    }
    if (pending.action === 'verify_email') {
        return stepPage({
            title: 'Verify your email',
            intro: `Enter the 6-digit code sent to ${pending.pendingEmail}.`,
            error,
            pendingId,
            hidden: {
                action: 'verify_email',
                pending_email: pending.pendingEmail || pending.email || ''
            },
            fields: '<label>Verification code</label><input name="otp" inputmode="numeric" autocomplete="one-time-code" required />',
            submitLabel: 'Verify email'
        });
    }
    if (pending.action === 'confirm_link' || pending.action === 'link') {
        return stepPage({
            title: 'Confirm Facebook linking',
            intro: `This Facebook email matches an existing KCC ID (${pending.email}). Sign in to that account, then confirm linking Facebook.`,
            error,
            pendingId,
            hidden: { action: 'confirm_link' },
            fields: '<label>Password for this KCC ID</label><input name="password" type="password" autocomplete="current-password" required />',
            submitLabel: 'Sign in and link Facebook'
        });
    }
    return stepPage({
        title: 'Finish Facebook sign-in',
        intro: 'We could not finish automatically. Close this page, return to Kincore, and tap Facebook again.',
        error: error || 'This step is no longer needed. Start Facebook sign-in again from the app.',
        pendingId,
        hidden: { action: 'noop' },
        fields: '',
        submitLabel: 'Close'
    });
};

const ensureFacebookAccount = async ({ email, profile }) => {
    const existing = await findUserByEmail(email);
    if (existing?.id) return existing.id;
    const { AuthService } = await import('./authService.js');
    const password = crypto.randomBytes(24).toString('base64url');
    try {
        await AuthService.signup({
            email,
            password,
            first_name: profile.firstName || '',
            last_name: profile.lastName || '',
            auto_verify: true
        });
    } catch (err) {
        if (!/already exists/i.test(String(err.message || ''))) throw err;
    }
    const row = await findUserByEmail(email);
    return row?.id || null;
};

const completeFacebookSignIn = async (pending, pendingId) => {
    if (pending.requireEmailVerification && !pending.emailVerified) {
        throw new Error('Verify your email before completing registration or linking.');
    }
    const email = String(pending.email || pending.pendingEmail || '').trim().toLowerCase();
    if (!isUsableFacebookEmail(email)) {
        throw new Error('A valid email is required to finish Facebook sign-in.');
    }
    const userId = pending.userId || (await findUserByEmail(email))?.id || await ensureFacebookAccount({
        email,
        profile: pending.profile
    });
    const token = await issueFacebookSession({
        email,
        clientType: pending.clientType,
        profile: pending.profile,
        userId
    });
    if (pendingId) deleteFacebookPending(pendingId);
    return {
        kind: 'token',
        token,
        clientType: pending.clientType,
        redirectTo: pending.redirectTo,
        code: pending.code
    };
};

const sendFacebookOtp = async ({ to, otp, firstName }) => {
    const { sendEmail } = await import('./emailService.js');
    const { renderOtpEmail } = await import('./emailTemplateService.js');
    const { html, text } = await renderOtpEmail({ otp, firstName });
    const result = await sendEmail({ to, subject: 'Your Kincore verification code', html, text });
    if (!result.ok) throw new Error(result.error || 'Failed to send the verification email');
};

/**
 * Facebook already linked → log in to that KCC ID.
 * Email matches an unlinked KCC ID → ask the user to sign in, then confirm linking.
 * No match → registration.
 * No email from Facebook → collect and verify an email first.
 */
export const beginFacebookSignIn = async ({ profile, clientType, redirectTo, code }) => {
    const decision = await classifyFacebookProfile(profile);
    if (decision.action === 'login') {
        const token = await issueFacebookSession({
            email: decision.email,
            clientType,
            profile,
            userId: decision.userId
        });
        return { kind: 'token', token };
    }
    if (decision.action === 'register') {
        await ensureFacebookAccount({ email: decision.email, profile });
        const token = await issueFacebookSession({
            email: decision.email,
            clientType,
            profile,
            userId: null
        });
        return { kind: 'token', token };
    }
    const pendingId = savePending({
        profile,
        clientType,
        redirectTo,
        code,
        action: decision.action,
        email: decision.email || '',
        userId: decision.userId || null,
        requireEmailVerification: decision.action === 'need_email',
        emailVerified: false
    });
    return { kind: 'html', html: pageForPending(pendingId, readPending(pendingId)) };
};

const resolveFacebookPending = (body = {}) => {
    const recoveryEmail = String(body.pending_email || body.email || '').trim().toLowerCase();
    let pendingId = String(body.pending_token || body.pending_id || '').trim();
    let pending = pendingId ? readPending(pendingId) : null;

    if (!pending && recoveryEmail.includes('@')) {
        const recovered = readFacebookPendingByEmail(recoveryEmail);
        if (recovered?.row) {
            pending = recovered.row;
            pendingId = recovered.id;
        }
    }

    if (!pending && recoveryEmail.includes('@')) {
        const id = `fbmail:${crypto.createHash('sha256').update(recoveryEmail).digest('hex').slice(0, 32)}`;
        pending = readFacebookPending(id);
        if (pending) pendingId = id;
    }

    return { pending, pendingId };
};

export const continueFacebookSignIn = async (body = {}) => {
    const recoveryEmail = String(body.pending_email || body.email || '').trim().toLowerCase();
    const { pending, pendingId } = resolveFacebookPending(body);
    if (!pending || !pendingId) {
        throw new Error(
            'This Facebook sign-in expired. Return to Kincore and tap Facebook again (do not refresh this page).'
        );
    }
    const fail = (message) => {
        const freshToken = writePending(pendingId, pending);
        return { kind: 'html', html: pageForPending(freshToken, pending, message) };
    };
    const action = String(body.action || pending.action || '');

    if (action === 'request_email') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!isUsableFacebookEmail(email)) return fail('Enter a valid email address.');
        const otp = String(crypto.randomInt(100000, 999999));
        pending.pendingEmail = email;
        pending.otp = otp;
        pending.otpExpiresAt = Date.now() + 10 * 60 * 1000;
        pending.action = 'verify_email';
        const nextToken = writePending(pendingId, pending);
        await sendFacebookOtp({ to: email, otp, firstName: pending.profile.firstName });
        return { kind: 'html', html: pageForPending(nextToken, pending) };
    }

    if (action === 'verify_email') {
        const otp = String(body.otp || '').trim();
        if (!pending.otp || Date.now() > pending.otpExpiresAt || otp !== pending.otp) {
            return fail('That verification code is incorrect or expired.');
        }
        pending.email = pending.pendingEmail;
        pending.otp = null;
        pending.emailVerified = true;
        const existing = await findUserByEmail(pending.email);
        pending.userId = existing?.id || null;
        if (existing?.id) {
            pending.action = 'confirm_link';
            const nextToken = writePending(pendingId, pending);
            return { kind: 'html', html: pageForPending(nextToken, pending) };
        }
        pending.action = 'register';
        writePending(pendingId, pending);
        try {
            const outcome = await completeFacebookSignIn(pending, pendingId);
            if (recoveryEmail.includes('@')) {
                deleteFacebookPending(`fbmail:${crypto.createHash('sha256').update(recoveryEmail).digest('hex').slice(0, 32)}`);
            }
            return outcome;
        } catch (err) {
            return fail(err.message);
        }
    }

    if (action === 'confirm_link' || action === 'link') {
        const password = String(body.password || '');
        if (!password) return fail('Enter the password for this KCC ID.');
        try {
            const { AuthService } = await import('./authService.js');
            await AuthService.login({
                email: pending.email,
                password,
                identifier: pending.email
            });
        } catch (err) {
            return fail(err.message || 'That password is incorrect. Sign in to the existing KCC ID, then confirm linking Facebook.');
        }
        try {
            return await completeFacebookSignIn(pending, pendingId);
        } catch (err) {
            return fail(err.message);
        }
    }

    if (action === 'register') {
        try {
            return await completeFacebookSignIn(pending, pendingId);
        } catch (err) {
            return fail(err.message);
        }
    }

    return fail('This Facebook step is no longer valid. Start Facebook sign-in again.');
};

export { createSessionForEmail, ensureUserFromSocialProfile };
