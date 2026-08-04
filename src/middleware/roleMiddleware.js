import { supabase } from '../config/supabaseClient.js';

/**
 * Middleware to restrict access based on dynamic membership roles.
 * @param {string[]} allowedRoles - List of roles permitted (e.g. ['owner', 'admin'])
 */
export const authorizeRoles = (allowedRoles) => {
    return async (req, res, next) => {
        try {
            const { user } = req;
            const familySpaceId = req.headers['x-family-space-id'] || req.body.family_space_id || req.query.family_space_id;

            if (!familySpaceId) {
                return res.status(400).json({ error: 'Family Space ID is required for role verification' });
            }

            // Fetch membership role for this specific user in this specific space
            const { data: membership, error } = await supabase
                .from('memberships')
                .select('role')
                .eq('user_id', user.id)
                .eq('family_space_id', familySpaceId)
                .single();

            if (error || !membership) {
                return res.status(403).json({ error: 'Forbidden: No valid membership found in this space' });
            }

            if (!allowedRoles.includes(membership.role)) {
                return res.status(403).json({ error: `Forbidden: This action requires one of [${allowedRoles.join(', ')}] roles` });
            }

            req.userRole = membership.role;
            next();
        } catch (err) {
            res.status(500).json({ error: 'Internal server error during role authorization' });
        }
    };
};
