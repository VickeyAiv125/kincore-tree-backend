import { supabase } from '../../config/supabaseClient.js';
import { clientApi } from '../../services/clientApiService.js';

/**
 * Proxy PlenorHub mall catalog: GET /api/v1/app/products
 */
export const getProducts = async (req, res) => {
    try {
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || null;
        const products = await clientApi.getAppProducts(req.query, token);
        res.json(products);
    } catch (err) {
        const status = err.response?.status || 502;
        res.status(status).json(err.response?.data || { error: err.message });
    }
};

export const getProductById = async (req, res) => {
    try {
        const token = req.headers.authorization?.replace(/^Bearer\s+/i, '') || null;
        const product = await clientApi.getAppProductById(req.params.id, req.query, token);
        res.json(product);
    } catch (err) {
        const status = err.response?.status || 502;
        res.status(status).json(err.response?.data || { error: err.message });
    }
};

export const getShippingRates = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'Authorization bearer token is required' });
        const data = await clientApi.getShippingRates(token, req.body);
        res.json(data);
    } catch (err) {
        const status = err.status || 500;
        res.status(status).json(err.payload || { error: err.message, missing: err.missing });
    }
};

/**
 * Create a checkout session and log the order locally.
 */
export const createOrder = async (req, res) => {
    try {
        const { items, total, shipping_address } = req.body;
        const { user } = req;
        const authHeader = req.headers.authorization;

        // 1. Call External BigK API to get Stripe session
        const session = await clientApi.getCheckoutSession(
            authHeader.split(' ')[1],
            items,
            shipping_address,
            { total }
        );

        // 2. Log pending order locally
        const { data, error } = await supabase
            .from('orders')
            .insert({
                user_id: user.id,
                order_number: `ORD-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                external_order_id: session.order_id || null,
                items,
                total,
                shipping_address,
                status: 'pending'
            })
            .select()
            .single();

        if (error) throw error;

        try {
            const { data: membership } = await supabase
                .from('family_memberships')
                .select('family_space_id')
                .eq('user_id', user.id)
                .limit(1)
                .maybeSingle();
            if (membership?.family_space_id) {
                const { dispatchNotification } = await import('../../services/notificationService.js');
                dispatchNotification(
                    membership.family_space_id,
                    'New purchase',
                    'New purchase started',
                    `Order ${data.order_number} for ${total || 0} was created.`
                ).catch(() => {});
            }
        } catch (_) { /* non-blocking */ }

        res.json({ checkout_url: session.url, local_order: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get user's order history.
 */
export const getOrderHistory = async (req, res) => {
    try {
        const { user } = req;
        const { data, error } = await supabase
            .from('orders')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
