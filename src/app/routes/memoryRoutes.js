import express from 'express';
import { getMemories, savePhoto, saveVideo } from '../controllers/memoryController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import multer from 'multer';

// Use memory storage for Multer as we are passing the buffer directly to Supabase Storage
const storage = multer.memoryStorage();
const upload = multer({ 
    storage,
    limits: {
        fileSize: 50 * 1024 * 1024 // 50MB max file size per upload
    }
});

const router = express.Router();

// GET /api/memories?family_space_id=...
router.get('/', authMiddleware, getMemories);

// POST /api/memories/photo
router.post('/photo', authMiddleware, upload.single('file'), savePhoto);

// POST /api/memories/video
router.post('/video', authMiddleware, upload.single('file'), saveVideo);

export default router;
