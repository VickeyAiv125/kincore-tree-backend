import { supabase } from '../../config/supabaseClient.js';

/**
 * Get digital albums.
 */
export const getAlbums = async (req, res) => {
    try {
        const { family_space_id } = req.query;
        const { data, error } = await supabase
            .from('albums')
            .select(`
                *,
                media_count:media(count)
            `)
            .eq('family_space_id', family_space_id);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new digital album.
 */
export const createAlbum = async (req, res) => {
    try {
        const { family_space_id, title, description, cover_url } = req.body;
        const { user } = req;

        const { data, error } = await supabase
            .from('albums')
            .insert({ family_space_id, creator_id: user.id, title, description, cover_url })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
