import express from 'express';
import { listSpaces, switchSpace } from '../controllers/spaceController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/list', authMiddleware, listSpaces);
router.post('/switch', authMiddleware, switchSpace);

export default router;
