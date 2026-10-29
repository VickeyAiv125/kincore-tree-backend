import express from 'express';
import { getWalletMe } from '../controllers/walletProxyController.js';

const router = express.Router();

router.get('/me', getWalletMe);

export default router;
