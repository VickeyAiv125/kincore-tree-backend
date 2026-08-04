import express from 'express';
import { getMedia, uploadMedia, uploadAvatar, deleteMedia, upload } from '../controllers/mediaController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

// GET all media for a family space: ?family_space_id=UUID&type=image
router.get('/', authMiddleware, getMedia);

// POST upload general media file (photo/video) → multipart/form-data
// Fields: file (required), family_space_id, visibility, attach_to_type, attach_to_id
router.post('/upload', authMiddleware, upload.single('file'), uploadMedia);

// POST upload avatar → multipart/form-data with field name 'file'
router.post('/upload/avatar', authMiddleware, upload.single('file'), uploadAvatar);

// DELETE a media record + file from storage
router.delete('/:id', authMiddleware, deleteMedia);

export default router;
