import { supabase } from '../config/supabaseClient.js';

export const authMiddleware = async (req, res, next) => {
    let token = '';
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token || token === 'null' || token === 'undefined') {
        return res.status(401).json({ error: 'No authentication token provided' });
    }

    // TESTING BYPASS
    if (token === 'dummy-test-token') {
        req.user = { id: 'a0ca8513-97df-46d2-b9d7-3db453288898', email: 'auditor@admin.com' };
        return next();
    }

    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);

        if (error || !user) {
            console.error('>>> [AUTH DEBUG] Token verification failed:', error?.message || 'No user found');
            console.error('>>> [AUTH DEBUG] Token prefix:', token?.substring(0, 15));
            return res.status(401).json({ error: 'Invalid or expired token', debug: error?.message });
        }

        req.user = user;
        next();
    } catch (err) {
        return res.status(500).json({ error: 'Internal server error during authentication' });
    }
};
