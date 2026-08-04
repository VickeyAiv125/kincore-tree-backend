import { supabase } from '../../config/supabaseClient.js';

// =========================================
// PRIVACY / SECURITY SETTINGS
// =========================================

/**
 * GET /api/settings/privacy
 * Returns the current user's privacy preferences.
 */
export const getPrivacySettings = async (req, res) => {
    try {
        const { user } = req;

        const { data, error } = await supabase
            .from('user_privacy_settings')
            .select('*')
            .eq('user_id', user.id)
            .maybeSingle();

        if (error) throw error;

        // Return defaults if no record yet
        res.json(data || {
            user_id: user.id,
            is_profile_locked: false,
            search_visibility: 'everyone', // everyone | friends | family
            hide_email: false,
            hide_phone: false,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * PATCH /api/settings/privacy
 * Update privacy preferences (upsert).
 */
export const updatePrivacySettings = async (req, res) => {
    try {
        const { user } = req;
        const { is_profile_locked, search_visibility, hide_email, hide_phone } = req.body;

        // 1. Check if settings exist for this user
        const { data: existing } = await supabase
            .from('user_privacy_settings')
            .select('id')
            .eq('user_id', user.id)
            .maybeSingle();

        const updateData = {
            user_id: user.id,
            ...(is_profile_locked !== undefined && { is_profile_locked }),
            ...(search_visibility && { search_visibility }),
            ...(hide_email !== undefined && { hide_email }),
            ...(hide_phone !== undefined && { hide_phone }),
            updated_at: new Date().toISOString(),
        };

        let result;
        if (existing) {
            // 2. Update existing record
            result = await supabase
                .from('user_privacy_settings')
                .update(updateData)
                .eq('user_id', user.id)
                .select()
                .single();
        } else {
            // 3. Insert new record
            result = await supabase
                .from('user_privacy_settings')
                .insert(updateData)
                .select()
                .single();
        }

        if (result.error) throw result.error;
        res.json({ message: 'Privacy settings saved.', settings: result.data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =========================================
// NOTIFICATIONS
// =========================================

/**
 * GET /api/settings/notifications
 * Get the user's notifications. Supports ?type= filter (event, gift, security, admin).
 */
export const getNotifications = async (req, res) => {
    try {
        const { user } = req;
        const { type } = req.query;

        let query = supabase
            .from('notifications')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (type && type !== 'All') {
            query = query.eq('type', type.toLowerCase());
        }

        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * PATCH /api/settings/notifications/:id/read
 * Mark a single notification as read.
 */
export const markNotificationRead = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { data, error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', id)
            .eq('user_id', user.id) // security: only own notifications
            .select()
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * PATCH /api/settings/notifications/mark-all-read
 * Mark all of the user's notifications as read.
 */
export const markAllNotificationsRead = async (req, res) => {
    try {
        const { user } = req;

        const { error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', user.id)
            .is('read_at', null); // Only update unread ones

        if (error) throw error;
        res.json({ message: 'All notifications marked as read.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE /api/settings/notifications/:id
 * Delete a single notification.
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
        res.json({ message: 'Notification deleted.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =========================================
// SAVED POSTS (Bookmarks)
// =========================================

/**
 * GET /api/settings/saved-posts
 * Get all posts the user has saved/bookmarked.
 */
export const getSavedPosts = async (req, res) => {
    try {
        const { user } = req;

        const { data, error } = await supabase
            .from('saved_posts')
            .select(`
                *,
                post:posts(
                    id, content, media_urls, post_type, created_at,
                    user:users!posts_user_id_fkey(first_name, last_name, avatar_url)
                )
            `)
            .eq('user_id', user.id)
            .order('saved_at', { ascending: false });

        if (error) throw error;
        res.json(data.map(s => s.post).filter(Boolean));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /api/settings/saved-posts
 * Save (bookmark) a post.
 */
export const savePost = async (req, res) => {
    try {
        const { post_id } = req.body;
        const { user } = req;

        if (!post_id) return res.status(400).json({ error: 'post_id is required' });

        const { data, error } = await supabase
            .from('saved_posts')
            .upsert({ user_id: user.id, post_id, saved_at: new Date().toISOString() }, { onConflict: 'user_id, post_id' })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ message: 'Post saved.', record: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE /api/settings/saved-posts/:post_id
 * Unsave (remove bookmark) a post.
 */
export const unsavePost = async (req, res) => {
    try {
        const { post_id } = req.params;
        const { user } = req;

        const { error } = await supabase
            .from('saved_posts')
            .delete()
            .eq('user_id', user.id)
            .eq('post_id', post_id);

        if (error) throw error;
        res.json({ message: 'Post removed from saved collection.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
