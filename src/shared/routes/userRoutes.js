import express from 'express';
import { getMe, updateMe } from '../controllers/userController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/me', authMiddleware, getMe);
router.put('/me', authMiddleware, updateMe);

export default router;
