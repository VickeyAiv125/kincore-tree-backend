import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';
import { upload } from '../../shared/controllers/mediaController.js';

/**
 * Handle Bio Creation with Multiple Media Uploads
 * Multipart fields: 
 *   cover_image (single file)
 *   gallery     (multiple files)
 *   title, location, bio_date, content (body)
 */
export const createBio = async (req, res) => {
    try {
        const { family_space_id } = req.params;
        const { title, location, bio_date, content } = req.body;
        const { user } = req;

        if (!title) return res.status(400).json({ error: 'Story Name (title) is required' });

        let cover_image_url = null;
        let gallery_urls = [];

        // 1. Handle Cover Image
        if (req.files && req.files.cover_image && req.files.cover_image[0]) {
            const file = req.files.cover_image[0];
            const ext = file.originalname.split('.').pop().toLowerCase();
            const path = `${family_space_id}/bios/${user.id}-${Date.now()}-cover.${ext}`;
            cover_image_url = await uploadFile(BUCKETS.MEDIA, path, file.buffer, file.mimetype);
        }

        // 2. Handle Gallery Images
        if (req.files && req.files.gallery) {
            for (const file of req.files.gallery) {
                const ext = file.originalname.split('.').pop().toLowerCase();
                const path = `${family_space_id}/bios/${user.id}-${Date.now()}-gallery-${Math.random().toString(36).substring(7)}.${ext}`;
                const url = await uploadFile(BUCKETS.MEDIA, path, file.buffer, file.mimetype);
                gallery_urls.push(url);
            }
        }

        // 3. Insert into family_bios
        const { data, error } = await supabase
            .from('family_bios')
            .insert({
                family_space_id,
                user_id: user.id,
                title,
                location: location || null,
                bio_date: bio_date || null,
                content: content || null,
                cover_image_url,
                gallery_urls
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
 * Get all bios for a family space.
 */
export const getBios = async (req, res) => {
    try {
        const { family_space_id } = req.params;
        const { data, error } = await supabase
            .from('family_bios')
            .select('*, users(first_name, last_name, avatar_url)')
            .eq('family_space_id', family_space_id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get single bio details.
 */
export const getBioDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('family_bios')
            .select('*, users(first_name, last_name, avatar_url)')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Bio not found' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Export multer config specifically for Bio
export const bioUpload = upload.fields([
    { name: 'cover_image', maxCount: 1 },
    { name: 'gallery', maxCount: 20 }
]);
