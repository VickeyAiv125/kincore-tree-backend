import express from 'express';
import { getAlbums, createAlbum } from '../controllers/albumController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();
router.get('/', authMiddleware, getAlbums);
router.post('/', authMiddleware, createAlbum);

export default router;
