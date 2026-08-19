import { AuthService } from '../../services/authService.js';
import {
    buildGoogleAuthorizeUrl,
    consumeGoogleOAuthState,
    createGoogleOAuthState,
    createSessionForEmail,
    ensureUserFromGoogleProfile,
    exchangeGoogleCode,
    getGoogleClientConfig
} from '../../services/googleAuthService.js';
import {
    buildFacebookAuthorizeUrl,
    consumeFacebookOAuthState,
    createFacebookOAuthState,
    exchangeFacebookCode,
    getFacebookClientConfig,
    ensureUserFromSocialProfile
} from '../../services/facebookAuthService.js';
import { getKccClientConfig, loginWithKccId } from '../../services/kccAuthService.js';
import {
    buildOAuthCallbackRedirect,
    parseOAuthStartQuery
} from '../../utils/oauthRedirectUtils.js';

export const signup = async (req, res) => {
    try {
        const { user, assignedRole, requires_email_confirmation } = await AuthService.signup(req.body);
        res.status(201).json({
            message: requires_email_confirmation
                ? 'Account created. Please check your email to confirm before signing in.'
                : 'User registered successfully',
            user,
            assigned_role: assignedRole || 'standard_user',
            requires_email_confirmation: !!requires_email_confirmation
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

export const login = async (req, res) => {
    try {
        const { email, password, identifier } = req.body;
        const result = await AuthService.login({ email, password, identifier });
        res.json({ message: 'Login successful', ...result });
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
};

export const oauthLogin = async (req, res) => {
    try {
        const result = await AuthService.oauthLogin(req.body);
        res.json({ message: 'OAuth login successful', ...result });
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
};

/**
 * GET /auth/google — start Google SSO (signup or login).
 */
export const googleAuthStart = async (req, res) => {
    const { mode, clientType, redirectTo } = parseOAuthStartQuery(req.query);
    try {
        const state = createGoogleOAuthState({ mode, clientType, redirectTo });
        const url = buildGoogleAuthorizeUrl({ state });
        return res.redirect(url);
    } catch (err) {
        console.error('[GOOGLE_AUTH_START]', err);
        return res.redirect(buildOAuthCallbackRedirect({
            clientType,
            redirectTo,
            error: err.message
        }));
    }
};

/**
 * GET /auth/google/callback — Google redirects here with ?code=
 */
export const googleAuthCallback = async (req, res) => {
    let clientType = 'web';
    let redirectTo = null;
    try {
        const { code, state, error, error_description: errorDescription } = req.query;
        const stateMeta = consumeGoogleOAuthState(String(state || ''));
        clientType = stateMeta?.clientType || 'web';
        redirectTo = stateMeta?.redirectTo || null;

        if (error) {
            throw new Error(errorDescription || error || 'Google authorization was denied');
        }
        if (!code) throw new Error('Missing authorization code from Google');
        if (!stateMeta) {
            throw new Error('Invalid or expired Google sign-in state. Please try again.');
        }

        const { profile } = await exchangeGoogleCode(String(code));
        if (!profile.emailVerified) {
            throw new Error('Google email is not verified. Use a verified Google account.');
        }

        await ensureUserFromGoogleProfile(profile);
        const session = await createSessionForEmail(profile.email);

        const result = await AuthService.oauthLogin({
            access_token: session.access_token,
            provider: 'google',
            client_type: clientType === 'app' ? 'app' : 'web',
            allow_signup: true
        });

        return res.redirect(buildOAuthCallbackRedirect({
            clientType,
            redirectTo,
            params: {
                token: result.token,
                provider: 'google'
            }
        }));
    } catch (err) {
        console.error('[GOOGLE_AUTH_CALLBACK]', err);
        return res.redirect(buildOAuthCallbackRedirect({
            clientType,
            redirectTo,
            error: err.message || 'Google sign-in failed'
        }));
    }
};

/** Health/config probe for UI (never returns secret). */
export const googleAuthStatus = async (_req, res) => {
    try {
        const { clientId, redirectUri } = getGoogleClientConfig();
        res.json({
            enabled: true,
            client_id: clientId,
            redirect_uri: redirectUri
        });
    } catch (err) {
        res.json({ enabled: false, error: err.message });
    }
};

/**
 * GET /auth/facebook — start Facebook / Meta SSO.
 */
export const facebookAuthStart = async (req, res) => {
    const { mode, clientType, redirectTo } = parseOAuthStartQuery(req.query);
    try {
        const state = createFacebookOAuthState({ mode, clientType, redirectTo });
        const url = buildFacebookAuthorizeUrl({ state });
        return res.redirect(url);
    } catch (err) {
        console.error('[FACEBOOK_AUTH_START]', err);
        return res.redirect(buildOAuthCallbackRedirect({
            clientType,
            redirectTo,
            error: err.message
        }));
    }
};

/**
 * GET /auth/facebook/callback — Facebook redirects here with ?code=
 */
export const facebookAuthCallback = async (req, res) => {
    let clientType = 'web';
    let redirectTo = null;
    try {
        const { code, state, error, error_description: errorDescription, error_reason: errorReason } = req.query;
        const stateMeta = consumeFacebookOAuthState(String(state || ''));
        clientType = stateMeta?.clientType || 'web';
        redirectTo = stateMeta?.redirectTo || null;

        if (error) {
            throw new Error(errorDescription || errorReason || error || 'Facebook authorization was denied');
        }
        if (!code) throw new Error('Missing authorization code from Facebook');
        if (!stateMeta) {
            throw new Error('Invalid or expired Facebook sign-in state. Please try again.');
        }

        const { profile } = await exchangeFacebookCode(String(code));
        await ensureUserFromSocialProfile(profile);
        const session = await createSessionForEmail(profile.email);

        const result = await AuthService.oauthLogin({
            access_token: session.access_token,
            provider: 'facebook',
            client_type: clientType === 'app' ? 'app' : 'web',
            allow_signup: true
        });

        return res.redirect(buildOAuthCallbackRedirect({
            clientType,
            redirectTo,
            params: {
                token: result.token,
                provider: 'facebook'
            }
        }));
    } catch (err) {
        console.error('[FACEBOOK_AUTH_CALLBACK]', err);
        return res.redirect(buildOAuthCallbackRedirect({
            clientType,
            redirectTo,
            error: err.message || 'Facebook sign-in failed'
        }));
    }
};

/** Health/config probe for UI (never returns secret). */
export const facebookAuthStatus = async (_req, res) => {
    try {
        const { appId, redirectUri } = getFacebookClientConfig();
        res.json({
            enabled: true,
            app_id: appId,
            redirect_uri: redirectUri
        });
    } catch (err) {
        res.json({ enabled: false, error: err.message });
    }
};

/**
 * POST /auth/kcc/login — Login with KCC ID (ecosystem passport).
 * Body: { identifier, password }
 */
export const kccLogin = async (req, res) => {
    try {
        const { identifier, password, email } = req.body || {};
        const result = await loginWithKccId({
            identifier: identifier || email,
            password
        });
        res.json({
            message: 'KCC ID login successful',
            token: result.token,
            user: result.user,
            kcc: result.kcc
        });
    } catch (err) {
        console.error('[KCC_LOGIN]', err.message);
        const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 401;
        res.status(status).json({
            error: err.message || 'KCC ID login failed',
            requires_2fa: Boolean(err.requires_2fa),
            challenge_token: err.challenge_token || undefined
        });
    }
};

export const kccAuthStatus = async (_req, res) => {
    try {
        const { baseUrl, clientId } = getKccClientConfig();
        res.json({
            enabled: true,
            base_url: baseUrl,
            client_id: clientId,
            login_mode: 'credential' // not browser-redirect like Google/Facebook
        });
    } catch (err) {
        res.json({ enabled: false, error: err.message });
    }
};

export const requestOtp = async (req, res) => {
    try {
        await AuthService.requestOtp(req.body);
        res.json({ message: 'OTP sent to email' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

export const verifyOtp = async (req, res) => {
    try {
        const session = await AuthService.verifyOtp(req.body);
        res.json({ message: 'Verification successful', session });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

export const changePassword = async (req, res) => {
    try {
        await AuthService.changePassword(req.body);
        res.json({ message: 'Password updated successfully' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

export const refreshToken = async (req, res) => {
    try {
        const session = await AuthService.refreshToken(req.body);
        res.json({ session });
    } catch (err) {
        res.status(401).json({ error: err.message });
    }
};

export const logout = async (req, res) => {
    try {
        await AuthService.logout();
        res.json({ message: 'Logged out successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const completeInvite = async (req, res) => {
    try {
        // user object is attached by authMiddleware
        await AuthService.completeInvite(req.user);

        // Fetch fresh roles and session info after invite promotion
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        const loginData = await AuthService.oauthLogin({
            access_token: token,
            email: req.user.email,
            client_type: 'web'
        });

        res.json({
            message: 'Invite completed successfully',
            token: loginData.token,
            user: loginData.user
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

export const webForgotPassword = async (req, res) => {
    try {
        await AuthService.webForgotPassword(req.body);
        res.json({ message: 'Password reset link sent to your email.' });
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

export const appForgotPassword = async (req, res) => {
    try {
        await AuthService.appForgotPassword(req.body);
        res.json({ message: '6-digit OTP code sent to your email.' });
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};

export const appResetPassword = async (req, res) => {
    try {
        await AuthService.appResetPassword(req.body);
        res.json({ message: 'Password reset successfully. You can now log in.' });
    } catch (err) {
        res.status(err.status || 400).json({ error: err.message });
    }
};
