import express from 'express';
import { getAppPrivacy, updateAppPrivacy } from '../controllers/appPrivacyController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', authMiddleware, getAppPrivacy);
router.post('/', authMiddleware, updateAppPrivacy);

export default router;
