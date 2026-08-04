import express from 'express';
import { getProfile, updateProfile, getGeneration, getMyRole } from '../controllers/profileController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

router.get('/', authMiddleware, getProfile);
router.put('/', authMiddleware, upload.single('avatar'), updateProfile);
router.get('/generation', authMiddleware, getGeneration);
router.get('/my-role', authMiddleware, getMyRole);

export default router;
