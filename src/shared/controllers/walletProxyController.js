import { supabase } from '../../config/supabaseClient.js';
import { clientApi } from '../../services/clientApiService.js';

const readBearer = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

const isLikelyKincoreSessionJwt = (token) => token.split('.').length === 3;

/**
 * GET /api/wallet/me — BigK wallet proxy (KCC token or Kincore session JWT).
 * Browsers must hit this via uat-api.kincore.com or the Traefik alias on uat-api.bigkpay.com.
 */
export const getWalletMe = async (req, res) => {
    const token = readBearer(req);
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }

    // 1) KCC wallet access token (mall / BigK user JWT)
    try {
        const data = await clientApi.getWalletDetails(token);
        return res.json(data);
    } catch (err) {
        const status = err.response?.status;
        const canTrySession = isLikelyKincoreSessionJwt(token)
            && (status === 401 || status === 403 || status === 404 || !status);
        if (!canTrySession) {
            const code = status || 502;
            const body = err.response?.data || { error: err.message || 'Wallet lookup failed' };
            return res.status(code).json(body);
        }
    }

    // 2) Kincore Supabase session (Flutter web after Google/password login)
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Invalid or expired session token.' });
        }
        const data = await clientApi.getWalletDetailsForKincoreUser(user.id, user.email);
        return res.json(data);
    } catch (err) {
        const status = err.response?.status || 401;
        const body = err.response?.data || { error: err.message || 'Wallet not available' };
        return res.status(status).json(body);
    }
};
