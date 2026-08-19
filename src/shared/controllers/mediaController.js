import multer from 'multer';
import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, deleteFile, BUCKETS } from '../../config/storageClient.js';

// Store file in memory so we can pass the buffer to Supabase Storage
const storage = multer.memoryStorage();
export const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/quicktime', 'application/pdf'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('File type not allowed. Use jpg, png, webp, gif, mp4, mov, or pdf.'));
    }
});

/**
 * Upload Media File → Supabase Storage (PRD section 12: Media Repository)
 * Stores in 'media' bucket under /family_space_id/userId-timestamp.ext
 * Also saves a record in the local `media` table.
 *
 * MULTIPART FORM-DATA fields:
 *   file           (required) — the actual file
 *   family_space_id (required)
 *   visibility      (optional, default: 'family')
 *   attach_to_type  (optional) — 'person' | 'event' | 'post' | 'history'
 *   attach_to_id    (optional) — UUID of the target
 */
export const uploadMedia = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use multipart/form-data with field name "file".' });

        const { family_space_id, visibility } = req.body;
        const { user } = req;

        if (!family_space_id) return res.status(400).json({ error: 'family_space_id is required' });

        // Build S3 path: media/SPACE_ID/USER_ID-timestamp.ext
        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const path = `${family_space_id}/${user.id}-${Date.now()}.${ext}`;

        const publicUrl = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype, family_space_id, user.id);

        // Insert only columns present on the `media` table (see backend/schema.sql).
        const mediaRow = {
            user_id: user.id,
            family_space_id,
            url: publicUrl,
            type: req.file.mimetype.startsWith('video') ? 'video' : 'image',
            visibility: visibility || 'family',
        };

        const { data, error } = await supabase.from('media').insert(mediaRow).select().single();

        if (error) {
            // Storage succeeded — still return the URL so tree/person forms can use the photo.
            console.warn('[uploadMedia] DB insert failed:', error.message);
            return res.status(201).json({
                message: 'File uploaded successfully',
                media: { ...mediaRow, id: null },
                url: publicUrl,
            });
        }

        res.status(201).json({ message: 'File uploaded successfully', media: data, url: publicUrl });
    } catch (err) {
        // Auto-log storage failures so the DevOps dashboard tracks Failed Uploads
        await supabase.from('system_incidents').insert({
            title: 'Automated: Storage Upload Failure',
            description: `Media upload failed: ${err.message}`,
            severity: 'low',
            status: 'investigating',
            affected_services: ['storage'],
            reported_by: req.user?.id || null
        });
        res.status(500).json({ error: err.message });
    }
};

/**
 * Upload Avatar → Supabase Storage (PRD section 9: Profiles & Bio)
 * Stores in 'avatars' bucket under /USER_ID/avatar.ext
 * Updates the user's avatar_url in the local `users` table.
 *
 * MULTIPART FORM-DATA fields:
 *   file (required) — must be an image
 */
export const uploadAvatar = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        if (!req.file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Avatar must be an image file.' });

        const { user } = req;
        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const path = `${user.id}/avatar.${ext}`;

        const publicUrl = await uploadFile(BUCKETS.AVATARS, path, req.file.buffer, req.file.mimetype);

        // Update user record
        const { error } = await supabase.from('users').update({ avatar_url: publicUrl }).eq('id', user.id);
        if (error) throw error;

        res.json({ message: 'Avatar updated', avatar_url: publicUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get all media for a family space.
 * Query params: family_space_id (required), type (optional: image|video)
 */
export const getMedia = async (req, res) => {
    try {
        const { family_space_id, type } = req.query;
        let query = supabase
            .from('media')
            .select('*')
            .eq('family_space_id', family_space_id);

        if (type) query = query.eq('type', type);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete a media file — removes from storage + DB record.
 */
export const deleteMedia = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { data: media, error: fetchErr } = await supabase
            .from('media').select('*').eq('id', id).maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!media) return res.status(404).json({ error: 'Media not found' });
        if (media.user_id !== user.id) return res.status(403).json({ error: 'You can only delete your own media' });

        // Extract storage path from URL
        const urlPath = new URL(media.url).pathname;
        const storagePath = urlPath.split('/object/public/media/')[1];
        if (storagePath) await deleteFile(BUCKETS.MEDIA, storagePath);

        await supabase.from('media').delete().eq('id', id);
        res.json({ message: 'Media deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
