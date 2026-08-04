import { EventService } from '../../services/eventService.js';
import { logActivity } from '../../utils/logger.js';

/**
 * List all events across the platform for Admin.
 */
export const getGlobalEvents = async (req, res) => {
    try {
        const events = await EventService.getEvents({ isAdmin: true, userId: req.user.id });
        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get single event details for editing.
 */
export const getAdminEventById = async (req, res) => {
    try {
        const { id } = req.params;
        const event = await EventService.getEventById(id);
        res.json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Admin creates a platform-wide or family event.
 */
export const adminCreateEvent = async (req, res) => {
    try {
        const { family_space_id, ...rest } = req.body;
        const file = req.file;

        const event = await EventService.createEvent({
            ...rest,
            family_space_id,
            creator_id: req.user.id
        }, file);

        await logActivity(
            req.user.id,
            'ADMIN_CREATE_EVENT',
            'events',
            event.id,
            req.ip,
            { title: event.title }
        );

        res.status(201).json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Admin deletes any event.
 */
export const adminDeleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        await EventService.deleteEvent(id);

        await logActivity(
            req.user.id,
            'ADMIN_DELETE_EVENT',
            'events',
            id,
            req.ip
        );

        res.json({ message: 'Event deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Admin updates any event.
 */
export const adminUpdateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const file = req.file;
        const event = await EventService.updateEvent(id, req.body, file);

        await logActivity(
            req.user.id,
            'ADMIN_UPDATE_EVENT',
            'events',
            id,
            req.ip,
            { title: event.title }
        );

        res.json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
