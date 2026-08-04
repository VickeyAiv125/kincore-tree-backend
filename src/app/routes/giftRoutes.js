import express from 'express';
import {
    setupGiftExchange,
    runDrawing,
    getMyPairing,
    updateWishlist
} from '../controllers/giftController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router({ mergeParams: true }); // Important to get eventId from parent router

// POST /api/events/:id/gift-exchange
router.post('/', authMiddleware, setupGiftExchange);

// POST /api/events/:id/gift-exchange/draw
router.post('/draw', authMiddleware, runDrawing);

// GET /api/events/:id/gift-exchange/my-pairing
router.get('/my-pairing', authMiddleware, getMyPairing);

// POST /api/events/:id/gift-exchange/wishlist
router.post('/wishlist', authMiddleware, updateWishlist);

export default router;
