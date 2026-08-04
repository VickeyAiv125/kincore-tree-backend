import express from 'express';
import {
    createPost,
    getPosts,
    deletePost,
    addReaction,
    addComment,
    getComments,
    deleteComment,
    toggleBookmark,
    getBookmarks,
    reportPost,
    getReels,
    upload
} from '../controllers/postController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

// ── Feed ──
// GET  /api/posts?family_space_id=UUID&page=1&limit=20
router.get('/', authMiddleware, getPosts);
router.get('/reels', authMiddleware, getReels);

// ── Create Post (multipart: content, family_space_id, visibility, tagged_users, up to 5 media files) ──
// POST /api/posts
router.post('/', authMiddleware, upload.array('media', 5), createPost);

// ── Delete Post ──
router.delete('/:id', authMiddleware, deletePost);

// ── Reactions (toggle heart/like) ──
// POST /api/posts/:id/react   body: { post_id, type: "heart" }
router.post('/:id/react', authMiddleware, addReaction);

// ── Comments ──
router.post('/:id/comments', authMiddleware, addComment);
router.get('/:id/comments', authMiddleware, getComments);
router.delete('/comments/:id', authMiddleware, deleteComment);

// ── Bookmarks ──
router.post('/bookmarks', authMiddleware, toggleBookmark);
router.get('/bookmarks/mine', authMiddleware, getBookmarks);

// ── Post Reports (moderation) ──
router.post('/report', authMiddleware, reportPost);

export default router;
