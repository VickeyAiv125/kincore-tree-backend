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

// The web app calls this right after Google login with family_space_id=null
// and no bearer token. A 401 there wipes the new session and returns to Sign Up.
const ignoreEmptyMemoryLookup = (req, res, next) => {
    const familyId = String(req.query.family_space_id || '').trim();
    const header = String(req.headers.authorization || '');
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const missingFamily = !familyId || familyId === 'null' || familyId === 'undefined';
    const missingToken = !token || token === 'null' || token === 'undefined';
    if (missingFamily && missingToken) {
        return res.json([]);
    }
    return next();
};

// GET /api/memories?family_space_id=...
router.get('/', ignoreEmptyMemoryLookup, authMiddleware, getMemories);

// POST /api/memories/photo
router.post('/photo', authMiddleware, upload.single('file'), savePhoto);

// POST /api/memories/video
router.post('/video', authMiddleware, upload.single('file'), saveVideo);

export default router;
