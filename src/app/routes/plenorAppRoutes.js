import express from 'express';
import axios from 'axios';
import { getProducts, getProductById } from '../controllers/orderController.js';

const router = express.Router({ mergeParams: true });

const plenorBase = () =>
    (process.env.PLENORHUB_API_BASE || 'https://uat-api.plenorhub.com/api/v1').replace(/\/$/, '');

/**
 * Forward browser mall traffic through UAT API to avoid PlenorHub CORS.
 * Mounted at /api/v1 so paths mirror PlenorHub (/app/..., /integration/..., /checkout/...).
 */
export const proxyPlenorV1 = async (req, res) => {
    try {
        const targetUrl = `${plenorBase()}${req.path}`;
        const headers = { Accept: 'application/json' };
        const auth = req.headers.authorization;
        if (auth) headers.Authorization = auth;
        if (req.headers['content-type'] && !['GET', 'HEAD'].includes(req.method.toUpperCase())) {
            headers['Content-Type'] = req.headers['content-type'];
        }

        const response = await axios({
            method: req.method,
            url: targetUrl,
            params: req.query,
            data: ['GET', 'HEAD'].includes(req.method.toUpperCase()) ? undefined : req.body,
            headers,
            timeout: 30000,
            validateStatus: () => true
        });

        res.status(response.status).json(response.data);
    } catch (err) {
        const status = err.response?.status || 502;
        res.status(status).json(err.response?.data || { error: err.message || 'PlenorHub proxy failed' });
    }
};

router.get('/app/products', getProducts);
router.get('/app/products/:id', getProductById);
router.use(proxyPlenorV1);

export default router;
