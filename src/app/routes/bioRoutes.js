import express from 'express';
import { createBio, getBios, getBioDetails, bioUpload } from '../controllers/bioController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

// ── Family Bio Endpoints ──

// POST create bio for a family space
// multipart/form-data: title, content, location, bio_date, cover_image, gallery[]
router.post('/:family_space_id/bios', authMiddleware, bioUpload, createBio);

// GET all bios for a family space
router.get('/:family_space_id/bios', authMiddleware, getBios);

// GET single bio details (generic route for bio ID)
router.get('/bios/:id', authMiddleware, getBioDetails);

export default router;
