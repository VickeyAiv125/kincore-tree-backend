import express from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { submitAbuseReport } from '../controllers/reportController.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', submitAbuseReport);

export default router;
