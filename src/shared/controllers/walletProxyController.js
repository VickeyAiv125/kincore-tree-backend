import { clientApi } from '../../services/clientApiService.js';

/**
 * GET /api/wallet/me — proxy to BigK UAT ( /api/v1/wallet/me or /app/me ).
 * Client must send Authorization: Bearer <KCC wallet access_token> (same as K-Mall).
 */
export const getWalletMe = async (req, res) => {
    const raw = req.headers.authorization || '';
    const token = raw.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
        return res.status(401).json({ error: 'Authorization required' });
    }

    try {
        const data = await clientApi.getWalletDetails(token);
        return res.json(data);
    } catch (err) {
        const status = err.response?.status || 502;
        const body = err.response?.data || { error: err.message || 'Wallet lookup failed' };
        return res.status(status).json(body);
    }
};
