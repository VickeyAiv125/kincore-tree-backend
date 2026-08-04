import express from 'express';
import {
    getEvents,
    createEvent,
    rsvpEvent,
    updateEvent,
    deleteEvent,
    getEventParticipants
} from '../controllers/eventController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFamilyRole } from '../../middleware/rbacMiddleware.js';
import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

router.get('/', authMiddleware, getEvents);
router.post('/', authMiddleware, upload.single('cover_photo'), createEvent);


// Tier 6: Management
router.patch('/:id', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin']), updateEvent);
router.delete('/:id', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin']), deleteEvent);

// RSVP & Participants
router.post('/rsvp', authMiddleware, rsvpEvent);
router.get('/:id/participants', authMiddleware, getEventParticipants);

export default router;
