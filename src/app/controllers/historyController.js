import { supabase } from '../../config/supabaseClient.js';

/**
 * Get family history chapters.
 */
export const getHistory = async (req, res) => {
    try {
        const { family_space_id } = req.query;
        const { data, error } = await supabase
            .from('family_history')
            .select('*')
            .eq('family_space_id', family_space_id)
            .order('sort_order', { ascending: true });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Add a history chapter.
 */
export const createHistoryChapter = async (req, res) => {
    try {
        const { family_space_id, title, content, cover_image, migration_link } = req.body;
        const { data, error } = await supabase
            .from('family_history')
            .insert({ family_space_id, title, content, cover_image, migration_link })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get migration history specifically formatted for the app UI.
 * GET /api/app/history/migrations
 */
export const getMigrationHistory = async (req, res) => {
    try {
        const { family_space_id } = req.query;
        if (!family_space_id) {
            return res.status(400).json({ error: 'family_space_id is required' });
        }

        const { data, error } = await supabase
            .from('migration_points')
            .select('*')
            .eq('family_space_id', family_space_id)
            .order('date_value', { ascending: false });

        if (error) throw error;

        const formattedData = data.map(point => {
            // Format the date to "MM/DD/YYYY : HH:MM PM" 
            const d = new Date(point.created_at);
            const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            
            // Calculate time ago
            const diffTime = Math.abs(new Date() - d);
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            let timeAgo = `${diffDays} days Ago`;
            if (diffDays === 0) timeAgo = 'Today';
            else if (diffDays === 1) timeAgo = '1 day Ago';

            // Override with "Current" if it's the most recent one (handled by UI, but we can default latest)
            
            return {
                id: point.id,
                year: point.date_value ? point.date_value.split('-')[0] : d.getFullYear().toString(),
                ui_date_tag: `${dateStr} : ${timeStr} : ${timeAgo}`,
                title: point.title,
                from_location: point.from_location,
                to_location: point.to_location,
                coordinates: {
                    from: { lat: point.from_lat, lng: point.from_lng },
                    to: { lat: point.to_lat, lng: point.to_lng }
                }
            };
        });

        // Set the most recent one to "Current" to perfectly match UI screenshot
        if (formattedData.length > 0) {
            const parts = formattedData[0].ui_date_tag.split(' : ');
            formattedData[0].ui_date_tag = `${parts[0]} : ${parts[1]} : Current`;
        }

        res.json({ data: formattedData });
    } catch (err) {
        console.error('Error fetching migration history:', err);
        res.status(500).json({ error: 'Server error' });
    }
};

/**
 * Get detailed information for a specific migration route (View Route).
 * GET /api/app/history/migrations/:id
 */
export const getMigrationRouteDetails = async (req, res) => {
    try {
        const { id } = req.params;

        const { data, error } = await supabase
            .from('migration_points')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') {
                return res.status(404).json({ error: 'Migration route not found' });
            }
            throw error;
        }

        const d = new Date(data.created_at);
        const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

        res.json({
            id: data.id,
            ui_date_tag: `${dateStr} : ${timeStr}`,
            title: data.title,
            from_location: data.from_location,
            to_location: data.to_location,
            reason: data.reason,
            description: data.description,
            media: data.media || [],
            coordinates: {
                from: { lat: data.from_lat, lng: data.from_lng },
                to: { lat: data.to_lat, lng: data.to_lng }
            }
        });
    } catch (err) {
        console.error('Error fetching migration route details:', err);
        res.status(500).json({ error: 'Server error' });
    }
};
