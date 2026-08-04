import express from 'express';
import { getSettings, updateSettings, getGlobalFees } from '../controllers/governanceController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/settings', authMiddleware, getSettings);
router.post('/settings', authMiddleware, updateSettings);

// Public API for mobile dev to fetch live fees
router.get('/fees', getGlobalFees);

export default router;
