import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';

/**
 * Fetch all active stories in the family space.
 * Automatically filters out expired stories (>24h).
 */
export const getStories = async (req, res) => {
    try {
        const { family_space_id } = req.query;
        const now = new Date().toISOString();

        const { data, error } = await supabase
            .from('stories')
            .select(`
                *,
                users (first_name, last_name, avatar_url)
            `)
            .eq('family_space_id', family_space_id)
            .gt('expires_at', now)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Upload a Story to Supabase Storage (PRD section 13A: Story System)
 * Stories bucket is separate from media (ephemeral storage policy).
 *
 * Accepts multipart/form-data:
 *   file            (required) — image or short video
 *   family_space_id (required)
 *   text_content    (optional) — text overlay
 *   visibility      (optional, default: 'family')
 *   duration_hours  (optional, default: 24) — 24 | 48 | 72
 */
export const createStory = async (req, res) => {
    try {
        const { family_space_id, text_content, visibility, duration_hours } = req.body;
        const { user } = req;

        if (!family_space_id) return res.status(400).json({ error: 'family_space_id is required' });

        let media_url = null;
        let media_type = 'text';

        // Upload file to stories bucket if provided
        if (req.file) {
            const ext = req.file.originalname.split('.').pop().toLowerCase();
            const path = `${family_space_id}/${user.id}-${Date.now()}.${ext}`;
            media_url = await uploadFile(BUCKETS.STORIES, path, req.file.buffer, req.file.mimetype);
            media_type = req.file.mimetype.startsWith('video') ? 'video' : 'image';
        }

        // Expiry: 24h default, max 72h (Family Admin configurable per PRD 13A.2)
        const hours = Math.min(parseInt(duration_hours) || 24, 72);
        const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

        const { data, error } = await supabase
            .from('stories')
            .insert({
                user_id: user.id,
                family_space_id,
                media_url,
                media_type,
                text_content: text_content || null,
                visibility: visibility || 'family',
                expires_at: expiresAt
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete a story (soft-delete by marking expired, media cleanup on lifecycle job).
 */
export const deleteStory = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { data: story } = await supabase.from('stories').select('user_id').eq('id', id).maybeSingle();
        if (!story) return res.status(404).json({ error: 'Story not found' });
        if (story.user_id !== user.id) return res.status(403).json({ error: 'Not your story' });

        await supabase.from('stories').update({ expires_at: new Date().toISOString() }).eq('id', id);
        res.json({ message: 'Story deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
