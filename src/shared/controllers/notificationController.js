import { supabase } from '../../config/supabaseClient.js';

/**
 * Get user notifications.
 * Supports:
 * - ?type=... (Filter by type)
 * - ?search=... (Search in title or message)
 */
export const getNotifications = async (req, res) => {
    try {
        const { user } = req;
        const { type, search } = req.query;

        console.log(`[Notifications] Fetching for user: ${user.id}`);

        let query = supabase
            .from('notifications')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (type && type !== 'All') {
            query = query.ilike('type', `%${type}%`);
        }

        if (search) {
            query = query.or(`title.ilike.%${search}%,message.ilike.%${search}%`);
        }

        const { data, error } = await query;

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Mark notification as read.
 */
export const markAsRead = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;
        res.json({ message: 'Notification marked as read' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Mark ALL notifications as read.
 */
export const markAllAsRead = async (req, res) => {
    try {
        const { user } = req;
        const { error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .is('read_at', null);

        if (error) throw error;
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete a notification.
 */
export const deleteNotification = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { error } = await supabase
            .from('notifications')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;
        res.json({ message: 'Notification deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * INTERNAL HELPER: Send a notification to a specific user.
 */
export const createNotification = async ({ user_id, type, title, message, metadata = {} }) => {
    try {
        const { error } = await supabase
            .from('notifications')
            .insert({
                user_id,
                type,
                title,
                message,
                notification_metadata: metadata,
                created_at: new Date().toISOString()
            });

        if (error) {
            console.error('[NotificationEngine] Error inserting:', error);
            return false;
        }
        return true;
    } catch (err) {
        console.error('[NotificationEngine] Unexpected crash:', err);
        return false;
    }
};
