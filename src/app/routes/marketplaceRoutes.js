import express from 'express';
import {
    getListings,
    getListing,
    createListing,
    updateListing,
    deleteListing,
    getMyListings,
    markSold,
    getSellerDashboard,
} from '../controllers/marketplaceController.js';
import {
    sendMessage,
    getChatHistory,
    getConversations
} from '../controllers/marketplaceChatController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import multer from 'multer';

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { files: 10 } }); // Max 10 images

const router = express.Router();

// Public-ish (auth required for context)
router.get('/', authMiddleware, getListings);
router.get('/my-listings', authMiddleware, getMyListings);
router.get('/seller/dashboard', authMiddleware, getSellerDashboard);
router.get('/:id', authMiddleware, getListing);

// Seller actions
router.post('/', authMiddleware, upload.array('images', 10), createListing);
router.patch('/:id', authMiddleware, updateListing);
router.patch('/:id/mark-sold', authMiddleware, markSold);
router.delete('/:id', authMiddleware, deleteListing);

// Chat actions
router.post('/chat/send', authMiddleware, sendMessage);
router.get('/chat/history', authMiddleware, getChatHistory);
router.get('/chat/conversations', authMiddleware, getConversations);

export default router;
