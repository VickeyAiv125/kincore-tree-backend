import { supabase } from '../../config/supabaseClient.js';

/**
 * Get privacy configuration for the app.
 * GET /api/app/privacy
 */
export const getAppPrivacy = async (req, res) => {
    try {
        const userId = req.user.id;

        // Fetch from user_privacy_settings
        const { data, error } = await supabase
            .from('user_privacy_settings')
            .select('search_visibility, is_profile_locked')
            .eq('user_id', userId)
            .maybeSingle();

        if (error && error.code !== 'PGRST116') throw error;

        // Map search_visibility or provide default
        res.status(200).json({
            visibility: data?.search_visibility || 'family'
        });

    } catch (error) {
        console.error('[getAppPrivacy] Error:', error);
        return res.status(500).json({ error: 'Internal server error fetching privacy configuration' });
    }
};

/**
 * Update privacy configuration for the app.
 * POST /api/app/privacy
 */
export const updateAppPrivacy = async (req, res) => {
    try {
        const userId = req.user.id;
        const { visibility } = req.body;

        const validOptions = ['public', 'family', 'close_relatives', 'lineage', 'admin', 'private'];
        if (!validOptions.includes(visibility)) {
            return res.status(400).json({ error: 'Invalid visibility option selected' });
        }

        // Upsert privacy configuration
        const { data, error } = await supabase
            .from('user_privacy_settings')
            .upsert(
                { 
                    user_id: userId, 
                    search_visibility: visibility,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'user_id' }
            )
            .select()
            .single();

        if (error) throw error;

        return res.status(200).json({
            success: true,
            message: 'Privacy configuration saved successfully',
            visibility: data.search_visibility
        });

    } catch (error) {
        console.error('[updateAppPrivacy] Error:', error);
        return res.status(500).json({ error: 'Internal server error updating privacy configuration' });
    }
};
