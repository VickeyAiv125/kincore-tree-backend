import { EventService } from '../../services/eventService.js';
import { logActivity } from '../../utils/logger.js';
import { createNotification } from '../../shared/controllers/notificationController.js';
import { supabase } from '../../config/supabaseClient.js';

/**
 * List all events in a family space for the Mobile App.
 */
export const getEvents = async (req, res) => {
    try {
        const { family_space_id, filter, search } = req.query;
        const { user } = req;

        if (!family_space_id) return res.status(400).json({ error: 'family_space_id is required' });

        const events = await EventService.getEvents({
            familyId: family_space_id,
            filter,
            search,
            userId: user.id
        });

        res.json(events);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new event for the Mobile App.
 */
export const createEvent = async (req, res) => {
    try {
        const { invited_user_ids, ...rest } = req.body;
        const { user } = req;

        const event = await EventService.createEvent({
            ...rest,
            creator_id: user.id
        }, req.file);

        // Handle invitations (existing logic kept but cleaned)
        if (invited_user_ids) {
            const ids = Array.isArray(invited_user_ids) ? invited_user_ids : JSON.parse(invited_user_ids);
            const { data: validUsers } = await supabase.from('users').select('id').in('id', ids);
            const validIds = validUsers?.map(u => u.id) || [];

            if (validIds.length > 0) {
                await supabase.from('event_rsvps').insert(validIds.map(uid => ({
                    event_id: event.id,
                    user_id: uid,
                    status: 'pending'
                })));

                for (const invitedId of validIds) {
                    await createNotification({
                        user_id: invitedId,
                        type: 'EVENT_INVITE',
                        title: 'New Event Invitation',
                        message: `You have been invited to: ${event.title}`,
                        metadata: { event_id: event.id, space_id: event.family_space_id }
                    });
                }
            }
        }

        await logActivity({
            actor_id: user.id,
            action: 'CREATE_EVENT',
            target_type: 'events',
            target_id: event.id,
            details: { title: event.title }
        });

        res.status(201).json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updateEvent = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await EventService.updateEvent(id, req.body);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const deleteEvent = async (req, res) => {
    try {
        const { id } = req.params;
        await EventService.deleteEvent(id);
        res.json({ message: 'Event deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const rsvpEvent = async (req, res) => {
    try {
        const { event_id, status, guest_count } = req.body;
        const data = await EventService.rsvpEvent(event_id, req.user.id, status);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getEventParticipants = async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('event_rsvps')
            .select('*, users(first_name, last_name, avatar_url)')
            .eq('event_id', id);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
