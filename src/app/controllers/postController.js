import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';
import { createNotification } from '../../shared/controllers/notificationController.js';
import multer from 'multer';

// Multer setup for post media uploads (images/videos)
const storage = multer.memoryStorage();
export const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB for videos
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('Only images and videos allowed.'));
    }
});

/**
 * GET Feed — family posts + stories bar
 * PRD Section 13: chronological, no algorithmic ranking
 * Visibility: family | branch | public
 */
export const getPosts = async (req, res) => {
    try {
        const { family_space_id, visibility, page = 1, limit = 20 } = req.query;
        const { user } = req;
        const offset = (page - 1) * limit;

        let dbQuery = supabase
            .from('posts')
            .select(`
                *,
                users (id, first_name, last_name, avatar_url),
                comments (id, content, created_at, users(first_name, last_name, avatar_url)),
                reactions (id, type, user_id)
            `)
            .eq('family_space_id', family_space_id)
            .is('deleted_at', null);

        if (visibility) {
            dbQuery = dbQuery.eq('visibility', visibility);
        } else {
            dbQuery = dbQuery.in('visibility', ['family', 'public']);
        }



        const { data, error } = await dbQuery
            .order('created_at', { ascending: false })
            .range(offset, offset + parseInt(limit) - 1);

        if (error) throw error;
        res.json({ posts: data, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET Reels — returns only posts with post_type = 'reel'
 */
export const getReels = async (req, res) => {
    try {
        const { family_space_id, page = 1, limit = 10 } = req.query;
        const offset = (page - 1) * limit;

        const { data, error } = await supabase
            .from('posts')
            .select(`
                *,
                users (id, first_name, last_name, avatar_url),
                comments (id, content, created_at, users(first_name, last_name, avatar_url)),
                reactions (id, type, user_id)
            `)
            .eq('post_type', 'reel')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(offset, offset + parseInt(limit) - 1);

        if (error) throw error;

        // Map data to match Flutter app expectations (ReelsController)
        const formatted = data.map(post => ({
            id: post.id,
            videoUrl: post.media_urls?.[0] || '',
            user: `${post.users.first_name || ''} ${post.users.last_name || ''}`.trim(),
            userPic: post.users.avatar_url || '',
            likes: post.reactions?.length || 0,
            isLiked: (post.reactions || []).some(r => r.user_id === req.user.id),
            comments: (post.comments?.length || 0).toString(),
            description: post.content,
            audio: 'Original Audio', // Static for now as per app
            created_at: post.created_at
        }));

        res.json(formatted);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST Create Post with optional media upload
 * Screen: "Create Post" — text + "Add media" button + "Tag people"
 * PRD Section 13: post types = text | media | event | milestone | product
 *
 * Accepts multipart/form-data:
 *   file[]         — optional, up to 5 images/videos (field name: 'media')
 *   content        — text body ("What's on your mind?")
 *   family_space_id
 *   visibility     — family | branch | public (default: family)
 *   post_type      — text | media | event | milestone | product (default: text)
 *   tagged_users   — JSON array of user IDs e.g. ["uuid1","uuid2"]
 */
export const createPost = async (req, res) => {
    try {
        const { family_space_id, content, visibility, post_type, tagged_users } = req.body;
        const { user } = req;

        if (!family_space_id) return res.status(400).json({ error: 'family_space_id is required' });

        // Ensure there is something to post (text or media)
        if (!content && (!req.files || req.files.length === 0)) {
            return res.status(400).json({ error: 'Content or media is required to create a post.' });
        }

        // Upload media files to Supabase storage
        let media_urls = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const ext = file.originalname.split('.').pop().toLowerCase();
                const path = `posts/${family_space_id}/${user.id}-${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;
                const url = await uploadFile(BUCKETS.MEDIA, path, file.buffer, file.mimetype);
                media_urls.push(url);
            }
        }

        // Parse tagged users
        let tags = [];
        if (tagged_users) {
            try { tags = JSON.parse(tagged_users); } catch { tags = []; }
        }

        // Determine Post Type based on media mimetypes & extensions (AI categorization)
        let final_post_type = post_type || 'text';
        if (req.files && req.files.length > 0) {
            const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.webm'];
            const hasVideo = req.files.some(file => {
                const isVideoMime = file.mimetype.startsWith('video/');
                const isVideoExt = videoExtensions.some(ext => file.originalname.toLowerCase().endsWith(ext));
                return isVideoMime || isVideoExt;
            });

            final_post_type = hasVideo ? 'reel' : 'media';
        }

        console.log(`[PostCreate] Final Type: ${final_post_type} | Files: ${req.files?.length || 0}`);

        const { data, error } = await supabase
            .from('posts')
            .insert({
                user_id: user.id,
                family_space_id,
                content: content || '',
                post_type: final_post_type,
                media_urls: media_urls.length > 0 ? media_urls : null,
                tagged_users: tags.length > 0 ? tags : null,
                visibility: visibility || 'family'
            })
            .select()
            .single();

        if (error) throw error;
        await logActivity(user.id, 'CREATE_POST', 'posts', data.id, null, data);

        const { dispatchNotification } = await import('../../services/notificationService.js');
        dispatchNotification(
            family_space_id,
            'New content posted',
            'New family content',
            content ? String(content).slice(0, 140) : 'A new post was published in your family space.'
        ).catch(() => {});

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE Post (soft delete)
 */
export const deletePost = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;
        const { data: post } = await supabase.from('posts').select('user_id').eq('id', id).maybeSingle();
        if (!post) return res.status(404).json({ error: 'Post not found' });
        if (post.user_id !== user.id) return res.status(403).json({ error: 'Not your post' });
        await supabase.from('posts').update({ deleted_at: new Date().toISOString() }).eq('id', id);
        res.json({ message: 'Post deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST Toggle Reaction on a post (like/heart etc.)
 * PRD: heart ❤️ is shown in the feed screenshot
 */
export const addReaction = async (req, res) => {
    try {
        const { post_id, type } = req.body;
        const { user } = req;

        const { data: existing } = await supabase
            .from('reactions')
            .select('id')
            .eq('post_id', post_id)
            .eq('user_id', user.id)
            .maybeSingle();

        if (existing) {
            await supabase.from('reactions').delete().eq('id', existing.id);
            return res.json({ message: 'Reaction removed', action: 'removed' });
        }

        const { data, error } = await supabase
            .from('reactions')
            .insert({ post_id, user_id: user.id, type: type || 'heart' })
            .select()
            .single();

        if (error) throw error;

        // ── TRIGGER NOTIFICATION (Except if reacting to own post) ──
        const { data: post } = await supabase.from('posts').select('user_id').eq('id', post_id).single();
        if (post && post.user_id !== user.id) {
            const { data: sender } = await supabase.from('users').select('first_name').eq('id', user.id).single();
            await createNotification({
                user_id: post.user_id,
                type: 'POST_REACTION',
                title: 'New Reaction',
                message: `${sender?.first_name || 'Someone'} reacted to your post`,
                metadata: { post_id }
            });
        }

        res.json({ ...data, action: 'added' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST Add comment to a post
 */
export const addComment = async (req, res) => {
    try {
        const { post_id, content } = req.body;
        const { user } = req;
        const { data, error } = await supabase
            .from('comments')
            .insert({ post_id, user_id: user.id, content })
            .select()
            .single();
        if (error) throw error;

        // ── TRIGGER NOTIFICATION (Except if commenting on own post) ──
        const { data: post } = await supabase.from('posts').select('user_id').eq('id', post_id).single();
        if (post && post.user_id !== user.id) {
            const { data: sender } = await supabase.from('users').select('first_name').eq('id', user.id).single();
            await createNotification({
                user_id: post.user_id,
                type: 'POST_COMMENT',
                title: 'New Comment',
                message: `${sender?.first_name || 'Someone'} commented on your post`,
                metadata: { post_id, comment_id: data.id }
            });
        }

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET Comments for a post
 */
export const getComments = async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('comments')
            .select('*, users(first_name, last_name, avatar_url)')
            .eq('post_id', id)
            .order('created_at', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * DELETE Comment
 */
export const deleteComment = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;
        const { data: comment } = await supabase.from('comments').select('user_id').eq('id', id).maybeSingle();
        if (!comment) return res.status(404).json({ error: 'Comment not found' });
        if (comment.user_id !== user.id) return res.status(403).json({ error: 'Not your comment' });
        await supabase.from('comments').delete().eq('id', id);
        res.json({ message: 'Comment deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST Bookmark a post (toggle)
 * PRD: bookmark icon visible on each post card in feed
 */
export const toggleBookmark = async (req, res) => {
    try {
        const { post_id } = req.body;
        const { user } = req;

        const { data: existing } = await supabase
            .from('bookmarks')
            .select('id')
            .eq('post_id', post_id)
            .eq('user_id', user.id)
            .maybeSingle();

        if (existing) {
            await supabase.from('bookmarks').delete().eq('id', existing.id);
            return res.json({ message: 'Bookmark removed', bookmarked: false });
        }

        await supabase.from('bookmarks').insert({ post_id, user_id: user.id });
        res.json({ message: 'Post bookmarked', bookmarked: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET My bookmarked posts
 */
export const getBookmarks = async (req, res) => {
    try {
        const { user } = req;
        const { data, error } = await supabase
            .from('bookmarks')
            .select('*, posts(*, users(first_name, last_name, avatar_url))')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST Report a post (moderation)
 * PRD Section 13: report/block support
 */
export const reportPost = async (req, res) => {
    try {
        const { post_id, reason } = req.body;
        const { user } = req;
        const { data, error } = await supabase
            .from('abuse_reports')
            .insert({ 
                target_id: post_id,
                target_type: 'post',
                reporter_id: user.id, 
                reason: reason || 'Inappropriate Content',
                status: 'pending'
            })
            .select()
            .single();
        if (error) throw error;

        await logActivity(user.id, 'SUBMIT_ABUSE_REPORT', 'abuse_reports', data.id, req.ip || null, {
            target_type: 'post',
            target_id: post_id,
            reason
        });

        try {
            const { data: post } = await supabase.from('posts').select('family_space_id').eq('id', post_id).maybeSingle();
            if (post?.family_space_id) {
                const { dispatchNotification } = await import('../../services/notificationService.js');
                dispatchNotification(
                    post.family_space_id,
                    'Abuse report',
                    'New abuse report',
                    reason || 'A post was reported for moderation.',
                    undefined,
                    { channel: 'abuse' }
                ).catch(() => {});
            }
        } catch (_) { /* non-blocking */ }

        res.status(201).json({ message: 'Post reported', report: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
