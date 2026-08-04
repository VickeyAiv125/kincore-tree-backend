/**
 * Supabase Storage Client (S3-compatible)
 * Endpoint: https://fpzuqnpoksaeacedirns.storage.supabase.co/storage/v1/s3
 * Region: ap-northeast-1
 *
 * PRD S3 usage areas:
 *  - General media (photos/videos) attached to posts/events/persons
 *  - Story media (ephemeral, separate bucket)
 *  - Profile avatars
 *  - PDF descendant reports
 */
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Same Supabase client — storage is accessed via .storage API
export const storageClient = createClient(supabaseUrl, serviceKey);

/**
 * Bucket names (must be pre-created in Supabase Dashboard → Storage)
 * - media       : general photos/videos, posts, events, persons
 * - stories     : ephemeral story media (auto-delete policy recommended)
 * - avatars     : user/person profile pictures
 * - reports     : generated PDF descendant reports
 */
export const BUCKETS = {
    MEDIA: 'media',
    STORIES: 'stories',
    AVATARS: 'avatars',
    REPORTS: 'reports'
};

/**
 * Auto-create a bucket if it doesn't exist yet.
 * Prevents "Bucket not found" errors when buckets haven't been set up in the Dashboard.
 */
async function ensureBucket(bucket) {
    const { data: buckets } = await storageClient.storage.listBuckets();
    const exists = buckets?.some(b => b.name === bucket);
    if (!exists) {
        const { error } = await storageClient.storage.createBucket(bucket, {
            public: bucket !== 'reports' // reports = private, all others = public
        });
        if (error && !error.message.includes('already exists')) {
            throw new Error(`Failed to create bucket "${bucket}": ${error.message}`);
        }
    }
}

/**
 * Upload a file buffer to a Supabase Storage bucket.
 * @param {string} bucket   - One of BUCKETS values
 * @param {string} path     - Storage path e.g. 'family-uuid/photo.jpg'
 * @param {Buffer} buffer   - File buffer from multer memoryStorage
 * @param {string} mimeType - e.g. 'image/jpeg'
 * @param {string} familySpaceId - (Optional) UUID of the family space to track storage against
 * @param {string} userId - (Optional) UUID of the uploading user
 * @returns {string}        - Public URL of the uploaded file
 */
export async function uploadFile(bucket, path, buffer, mimeType, familySpaceId = null, userId = null) {
    await ensureBucket(bucket); // auto-create bucket if missing

    // --- Storage Quota Check ---
    if (familySpaceId) {
        const { data: space } = await storageClient.from('family_spaces')
            .select('storage_used_bytes, storage_quota_bytes')
            .eq('id', familySpaceId)
            .single();
        
        if (space && (space.storage_used_bytes + buffer.length > space.storage_quota_bytes)) {
            throw new Error(`STORAGE_LIMIT_EXCEEDED`);
        }
    }

    const { error } = await storageClient.storage
        .from(bucket)
        .upload(path, buffer, {
            contentType: mimeType,
            upsert: true
        });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const { data } = storageClient.storage.from(bucket).getPublicUrl(path);
    
    // --- Storage File Logging ---
    if (familySpaceId && userId) {
        await storageClient.from('family_files').insert({
            family_space_id: familySpaceId,
            uploaded_by_user_id: userId,
            file_size_bytes: buffer.length,
            file_url: data.publicUrl,
            file_type: mimeType
        });
    }

    return data.publicUrl;
}

/**
 * Delete a file from a bucket.
 * @param {string} bucket
 * @param {string} path
 */
export async function deleteFile(bucket, path) {
    const { error } = await storageClient.storage.from(bucket).remove([path]);
    if (error) throw new Error(`Storage delete failed: ${error.message}`);

    // Clean up tracking table (trigger handles byte deduction)
    const { data: pubData } = storageClient.storage.from(bucket).getPublicUrl(path);
    if (pubData && pubData.publicUrl) {
        await storageClient.from('family_files').delete().eq('file_url', pubData.publicUrl);
    }
}
