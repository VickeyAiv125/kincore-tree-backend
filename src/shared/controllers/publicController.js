import { supabase } from '../../config/supabaseClient.js';

/**
 * Search for people in the PUBLIC directory.
 * (Only returns persons with privacy_mode = 'public').
 */
export const searchPublicPersons = async (req, res) => {
    try {
        const { q } = req.query;
        const { data, error } = await supabase
            .from('persons')
            .select('id, full_name, chinese_name, avatar_url, birth_date, gender, family_spaces(settings)')
            .eq('privacy_mode', 'public')
            .ilike('full_name', `%${q}%`);

        if (error) throw error;
        
        const filtered = (data || []).filter(p => {
            const settings = p.family_spaces?.settings || {};
            return settings.lineageVisibility !== false;
        }).map(p => {
            const { family_spaces, ...rest } = p;
            return rest;
        });

        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get a public person's basic profile.
 */
export const getPublicPerson = async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('persons')
            .select('id, full_name, chinese_name, avatar_url, birth_date, gender, bio')
            .eq('id', id)
            .eq('privacy_mode', 'public')
            .single();

        if (error) throw error || new Error('Person not found or private');
        res.json(data);
    } catch (err) {
        res.status(404).json({ error: err.message });
    }
};
