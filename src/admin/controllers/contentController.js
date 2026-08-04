import { supabase } from '../../config/supabaseClient.js';

/**
 * Get all announcements (Public).
 */
export const getAnnouncements = async (req, res) => {
    try {
        const { category } = req.query;
        let query = supabase.from('announcements').select(`
            *,
            author:users!author_id (first_name, last_name, avatar_url)
        `);

        if (category) query = query.eq('category', category);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new announcement (Content Creator/Owner).
 */
export const createAnnouncement = async (req, res) => {
    try {
        const { title, content, category, is_public } = req.body;
        const { user } = req;

        const { data, error } = await supabase
            .from('announcements')
            .insert({
                title,
                content,
                category,
                is_public,
                author_id: user.id
            })
            .select()
            .single();

        if (error) throw error;

        // Audit log
        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: 'ANNOUNCEMENT_CREATED',
            target_type: 'announcements',
            target_id: data.id,
            details: { title }
        });

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete an announcement.
 */
export const deleteAnnouncement = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { error } = await supabase
            .from('announcements')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ message: 'Announcement deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
