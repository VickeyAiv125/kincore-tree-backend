import express from 'express';
import {
    setupGiftExchange,
    joinGiftExchange,
    runDrawing,
    getGiftParticipants,
    spinGiftWheel,
    getMyRecipient,
    getMyPairing,
    updateGiftStatus,
    updateWishlist
} from '../controllers/giftController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router({ mergeParams: true }); // :id from /api/events/:id/gift-exchange

// POST /api/events/:id/gift-exchange — setup/update gift settings (creator)
router.post('/', authMiddleware, setupGiftExchange);

// POST /api/events/:id/gift-exchange/join
router.post('/join', authMiddleware, joinGiftExchange);

// GET /api/events/:id/gift-exchange/participants
router.get('/participants', authMiddleware, getGiftParticipants);

// POST /api/events/:id/gift-exchange/winner — fortune wheel lands on winner_index
router.post('/winner', authMiddleware, spinGiftWheel);

// POST /api/events/:id/gift-exchange/draw
router.post('/draw', authMiddleware, runDrawing);

// GET /api/events/:id/gift-exchange/my-recipient
router.get('/my-recipient', authMiddleware, getMyRecipient);

// Legacy alias
router.get('/my-pairing', authMiddleware, getMyPairing);

// PATCH /api/events/:id/gift-exchange/status
router.patch('/status', authMiddleware, updateGiftStatus);

// Legacy wishlist → preferences
router.post('/wishlist', authMiddleware, updateWishlist);

export default router;
