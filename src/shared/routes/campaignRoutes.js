import express from 'express';
import { createCampaign, getCampaigns, reviewCampaign } from '../controllers/campaignController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware);

router.post('/', createCampaign);
router.get('/', getCampaigns);
router.patch('/:campaignId/review', reviewCampaign);

export default router;
