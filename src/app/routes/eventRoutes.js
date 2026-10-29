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
import { supabase } from '../../config/supabaseClient.js';

const router = express.Router();

/** Load the event and set family_space_id for RBAC when the client only sends :id. */
const attachEventFamilyScope = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { data: event, error } = await supabase
            .from('events')
            .select('id, family_space_id, creator_id, title')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        if (!event) return res.status(404).json({ error: 'Event not found' });
        req.eventRecord = event;
        req.body = req.body || {};
        if (!req.body.family_space_id) req.body.family_space_id = event.family_space_id;
        next();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const allowEventManager = (req, res, next) => {
    if (req.eventRecord?.creator_id && req.user?.id === req.eventRecord.creator_id) {
        req.familySpaceId = req.eventRecord.family_space_id;
        return next();
    }
    return requireFamilyRole('family_space_id', ['owner', 'admin', 'family-admin', 'co-admin'])(req, res, next);
};

const coverUpload = upload.fields([{ name: 'cover_photo', maxCount: 1 }, { name: 'cover_image', maxCount: 1 }]);
const attachCoverFile = (req, _res, next) => {
    req.file = req.files?.cover_photo?.[0] || req.files?.cover_image?.[0] || req.file;
    next();
};

router.get('/', authMiddleware, getEvents);
router.post('/', authMiddleware, upload.fields([{ name: 'cover_photo', maxCount: 1 }, { name: 'cover_image', maxCount: 1 }]), (req, res, next) => {
    req.file = req.files?.cover_photo?.[0] || req.files?.cover_image?.[0] || req.file;
    next();
}, createEvent);


// Edit / delete (creator, or family owner/admin)
router.patch('/:id', authMiddleware, attachEventFamilyScope, allowEventManager, coverUpload, attachCoverFile, updateEvent);
router.delete('/:id', authMiddleware, attachEventFamilyScope, allowEventManager, deleteEvent);

// RSVP & Participants
router.post('/rsvp', authMiddleware, rsvpEvent);
router.get('/:id/participants', authMiddleware, getEventParticipants);

export default router;
