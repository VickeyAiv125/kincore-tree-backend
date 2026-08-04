import express from 'express';
import { getAppMembers } from '../controllers/memberController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', authMiddleware, getAppMembers);

export default router;
