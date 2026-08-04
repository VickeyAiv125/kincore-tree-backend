import { supabase } from '../../config/supabaseClient.js';

/**
 * List all internal platform administrators.
 */
export const getAdmins = async (req, res) => {
    try {
        const { role } = req.query;
        let query = supabase.from('admin_users').select(`
            *,
            users (id, first_name, last_name, email, avatar_url)
        `);

        if (role) query = query.eq('role', role);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get detailed activity logs for a specific admin.
 */
export const getAdminAudit = async (req, res) => {
    try {
        const { admin_id } = req.params;
        const { data, error } = await supabase
            .from('audit_logs')
            .select('*')
            .eq('actor_id', admin_id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Remove an admin from the platform team.
 */
export const removeAdmin = async (req, res) => {
    try {
        const { id } = req.params; // user_id
        const { user: actor } = req;

        const { error } = await supabase
            .from('admin_users')
            .delete()
            .eq('user_id', id);

        if (error) throw error;

        // Audit log
        await supabase.from('audit_logs').insert({
            actor_id: actor.id,
            action: 'ADMIN_REMOVED',
            target_type: 'admin_users',
            target_id: id,
            details: { removed_admin: id }
        });

        res.json({ message: 'Admin access revoked successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
