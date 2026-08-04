import express from 'express';
import { getRooms, getMessages, sendMessage } from '../controllers/chatController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/chat/rooms?family_space_id=UUID
router.get('/rooms', authMiddleware, getRooms);

// GET /api/chat/rooms/:roomId/messages?page=1&limit=50
router.get('/rooms/:roomId/messages', authMiddleware, getMessages);

// POST /api/chat/messages
// Body: { room_id, content, media_url, family_space_id } OR { recipient_id, content, ... }
router.post('/messages', authMiddleware, sendMessage);

export default router;
