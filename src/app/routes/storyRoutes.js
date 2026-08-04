import express from 'express';
import { getStories, createStory, deleteStory } from '../controllers/storyController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

// GET active stories: ?family_space_id=UUID (filter out expired)
router.get('/', authMiddleware, getStories);

// POST create story (multipart: file optional, text-based stories allowed)
router.post('/', authMiddleware, upload.single('file'), createStory);

// DELETE story (soft-delete by expiring it)
router.delete('/:id', authMiddleware, deleteStory);

export default router;
