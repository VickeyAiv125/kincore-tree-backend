import express from 'express';
import { getUserRequests } from '../controllers/requestController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/requests
router.get('/', authMiddleware, getUserRequests);

export default router;
