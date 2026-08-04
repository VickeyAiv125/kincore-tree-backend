import express from 'express';
import { getMyBalance, getHistory, transferCoins } from '../controllers/ledgerController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/balance', authMiddleware, getMyBalance);
router.get('/history', authMiddleware, getHistory);
router.post('/transfer', authMiddleware, transferCoins);

export default router;
