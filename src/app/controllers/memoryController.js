import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';

/**
 * Helper to check storage quota before allowing an upload.
 * It queries system_configs for quota_storage_gb, then calculates total size used by the family space in the media table.
 */
async function checkStorageQuota(familySpaceId, newFileSize) {
    // 1. Get Quota Limit
    const { data: config } = await supabase
        .from('system_configs')
        .select('value')
        .eq('key', 'quota_storage_gb')
        .single();
    
    // Default to 10GB if not found
    const quotaGb = config ? parseFloat(config.value) : 10;
    const quotaBytes = quotaGb * 1024 * 1024 * 1024;

    // 2. Get Current Used Storage
    const { data: mediaFiles, error } = await supabase
        .from('media')
        .select('size')
        .eq('family_space_id', familySpaceId);

    if (error) throw error;

    const usedBytes = mediaFiles.reduce((acc, file) => acc + (file.size || 0), 0);

    // 3. Check if new file exceeds quota
    if (usedBytes + newFileSize > quotaBytes) {
        throw new Error('Storage limit exceeded. Please upgrade your family space plan or delete some memories.');
    }
    return true;
}

/**
 * Get all memories (photos and videos) for a specific family space.
 */
export const getMemories = async (req, res) => {
    try {
        const { family_space_id } = req.query;
        if (!family_space_id) {
            return res.status(400).json({ error: 'family_space_id is required' });
        }

        const { data, error } = await supabase
            .from('media')
            .select(`
                *,
                user:user_id(first_name, last_name, avatar_url)
            `)
            .eq('family_space_id', family_space_id)
            .in('type', ['image', 'video'])
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Upload and save a photo memory.
 */
export const savePhoto = async (req, res) => {
    try {
        const { family_space_id, visibility } = req.body;
        const { user } = req;

        if (!family_space_id) return res.status(400).json({ error: 'family_space_id is required' });
        if (!req.file) return res.status(400).json({ error: 'No photo file provided' });

        const newFileSize = req.file.size;

        // Verify Storage Quota
        try {
            await checkStorageQuota(family_space_id, newFileSize);
        } catch (quotaError) {
            return res.status(403).json({ error: quotaError.message });
        }

        // Upload to storage
        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const path = `memories/${family_space_id}/${user.id}-photo-${Date.now()}.${ext}`;
        
        const media_url = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype);

        // Save to DB
        const { data, error } = await supabase
            .from('media')
            .insert({
                user_id: user.id,
                family_space_id,
                url: media_url,
                type: 'image',
                size: newFileSize,
                visibility: visibility || 'family'
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ message: 'Photo saved successfully', memory: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Upload and save a video memory.
 */
export const saveVideo = async (req, res) => {
    try {
        const { family_space_id, visibility } = req.body;
        const { user } = req;

        if (!family_space_id) return res.status(400).json({ error: 'family_space_id is required' });
        if (!req.file) return res.status(400).json({ error: 'No video file provided' });

        const newFileSize = req.file.size;

        // Verify Storage Quota
        try {
            await checkStorageQuota(family_space_id, newFileSize);
        } catch (quotaError) {
            return res.status(403).json({ error: quotaError.message });
        }

        // Upload to storage
        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const path = `memories/${family_space_id}/${user.id}-video-${Date.now()}.${ext}`;
        
        const media_url = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype);

        // Save to DB
        const { data, error } = await supabase
            .from('media')
            .insert({
                user_id: user.id,
                family_space_id,
                url: media_url,
                type: 'video',
                size: newFileSize,
                visibility: visibility || 'family'
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ message: 'Video saved successfully', memory: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
