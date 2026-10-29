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
    saveFacebookOAuthState,
    saveFacebookPending
} from '../utils/oauthHandoffStore.js';

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

export const createFacebookOAuthState = (meta = {}) => {
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

const classifyFacebookProfile = async (profile) => {
    const linked = await findAuthUserByFacebookSub(profile.sub);
    if (linked?.email && isUsableFacebookEmail(linked.email)) {
        return { action: 'login', email: String(linked.email).trim().toLowerCase(), userId: linked.id };
    }
    if (!isUsableFacebookEmail(profile.email)) {
        return { action: 'need_email' };
    }
    const existing = await findUserByEmail(profile.email);
    if (existing?.id) {
        return { action: 'link', email: profile.email, userId: existing.id };
    }
    return { action: 'register', email: profile.email };
};

const savePending = (row) => {
    const id = crypto.randomBytes(24).toString('hex');
    saveFacebookPending(id, { ...row, createdAt: Date.now() });
    return id;
};

const readPending = (id) => readFacebookPending(id);

const writePending = (id, row) => saveFacebookPending(id, row);

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
            intro: 'Facebook did not share an email. Enter an email and verify it before you can continue.',
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
            hidden: { action: 'verify_email' },
            fields: '<label>Verification code</label><input name="otp" inputmode="numeric" autocomplete="one-time-code" required />',
            submitLabel: 'Verify email'
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
 * Facebook already linked, or its email matches an existing account → sign in and link.
 * No match → registration.
 * No email from Facebook → collect and verify an email first.
 */
export const beginFacebookSignIn = async ({ profile, clientType, redirectTo, code }) => {
    const decision = await classifyFacebookProfile(profile);
    if (decision.action === 'login' || decision.action === 'link') {
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
        userId: decision.userId || null
    });
    return { kind: 'html', html: pageForPending(pendingId, readPending(pendingId)) };
};

export const continueFacebookSignIn = async (body = {}) => {
    const pending = readPending(body.pending_id);
    if (!pending) {
        throw new Error('This Facebook sign-in expired. Return to Kincore and tap Facebook again.');
    }
    const fail = (message) => ({ kind: 'html', html: pageForPending(body.pending_id, pending, message) });
    const action = String(body.action || pending.action || '');

    if (action === 'request_email') {
        const email = String(body.email || '').trim().toLowerCase();
        if (!isUsableFacebookEmail(email)) return fail('Enter a valid email address.');
        const otp = String(crypto.randomInt(100000, 999999));
        pending.pendingEmail = email;
        pending.otp = otp;
        pending.otpExpiresAt = Date.now() + 10 * 60 * 1000;
        pending.action = 'verify_email';
        writePending(body.pending_id, pending);
        await sendFacebookOtp({ to: email, otp, firstName: pending.profile.firstName });
        return { kind: 'html', html: pageForPending(body.pending_id, pending) };
    }

    if (action === 'verify_email') {
        const otp = String(body.otp || '').trim();
        if (!pending.otp || Date.now() > pending.otpExpiresAt || otp !== pending.otp) {
            return fail('That verification code is incorrect or expired.');
        }
        pending.email = pending.pendingEmail;
        pending.otp = null;
        const existing = await findUserByEmail(pending.email);
        pending.userId = existing?.id || null;
        writePending(body.pending_id, pending);
        try {
            return await completeFacebookSignIn(pending, body.pending_id);
        } catch (err) {
            return fail(err.message);
        }
    }

    if (action === 'link' || action === 'register') {
        try {
            return await completeFacebookSignIn(pending, body.pending_id);
        } catch (err) {
            return fail(err.message);
        }
    }

    return fail('This Facebook step is no longer valid. Start Facebook sign-in again.');
};

export { createSessionForEmail, ensureUserFromSocialProfile };
