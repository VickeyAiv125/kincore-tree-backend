import { supabase } from '../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../config/storageClient.js';

export const EventService = {
    /**
     * Comprehensive event fetcher.
     * Supports filtering by family, type, and current status.
     */
    async getEvents({ familyId, filter, search, isAdmin = false, userId = null } = {}) {
        const now = new Date().toISOString();

        let query = supabase
            .from('events')
            .select(`
                *,
                creator:users!events_creator_id_fkey(first_name, last_name, avatar_url),
                rsvps:event_rsvps(status, user_id, users(avatar_url)),
                family:family_spaces(name)
            `);

        if (familyId && !isAdmin) {
            query = query.eq('family_space_id', familyId);
        }

        if (filter === 'past') {
            query = query.lt('start_date', now).order('start_date', { ascending: false });
        } else if (filter === 'upcoming') {
            query = query.gte('start_date', now).order('start_date', { ascending: true });
        } else if (!isAdmin) {
            // Default for mobile/non-admin: only upcoming
            query = query.gte('start_date', now).order('start_date', { ascending: true });
        } else {
            // Default for admin: All events
            query = query.order('created_at', { ascending: false });
        }

        if (search) {
            query = query.ilike('title', `%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        return data.map(event => this.normalizeEvent(event, userId));
    },

    normalizeEvent(event, userId = null) {
        if (!event) return null;
        let rsvps = [...(event.rsvps || [])];
        let description = event.description || '';

        // Extract and parse hidden ritual metadata
        const ritualMatch = description.match(/<!--RITUAL_DATA:(.*)-->/);
        let ritualData = {};
        if (ritualMatch && ritualMatch[1]) {
            try {
                ritualData = JSON.parse(ritualMatch[1]);
                description = description.replace(/<!--RITUAL_DATA:.*-->/g, '').trim();
            } catch (e) {
                console.error('Failed to parse ritual data:', e);
            }
        }

        // Extract and parse hidden persons metadata
        const metadataMatch = description.match(/<!--INVITED_PERSONS:(.*)-->/);
        if (metadataMatch && metadataMatch[1]) {
            const personIds = metadataMatch[1].split(',');
            personIds.forEach(pid => {
                if (!rsvps.find(r => r.user_id === pid)) {
                    rsvps.push({ user_id: pid, status: 'pending', type: 'person_metadata' });
                }
            });
            // Clean description for UI display
            description = description.replace(/<!--INVITED_PERSONS:.*-->/g, '').trim();
        }

        const d = new Date(event.start_date);

        return {
            ...event,
            ...ritualData,
            description,
            rsvps,
            date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
            time: event.event_time || d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            status: userId ? (rsvps.find(r => r.user_id === userId)?.status || 'Join Now') : 'Upcoming',
            members: rsvps
                .filter(r => r.status === 'going' || r.status === 'accepted')
                .map(r => ({
                    avatar_url: r.users?.avatar_url,
                    name: r.users ? `${r.users.first_name} ${r.users.last_name}` : 'Member'
                })),
            going_count: rsvps.filter(r => r.status === 'going' || r.status === 'accepted').length,
            maybe_count: rsvps.filter(r => r.status === 'maybe').length,
            declined_count: rsvps.filter(r => r.status === 'declined').length,
            participant_count: rsvps.filter(r => r.status === 'going' || r.status === 'accepted').length,
            hosted_by: event.creator ? `${event.creator.first_name} ${event.creator.last_name}` : (event.family?.name || 'Family'),
            host_avatar: event.creator?.avatar_url || '',
            image_url: event.cover_image || event.cover_photo_url || ''
        };
    },

    async getEventById(id, userId = null) {
        const { data, error } = await supabase
            .from('events')
            .select(`
                *,
                creator:users!events_creator_id_fkey(first_name, last_name, avatar_url),
                rsvps:event_rsvps(status, user_id, users(avatar_url)),
                family:family_spaces(name)
            `)
            .eq('id', id)
            .single();

        if (error) throw error;
        return this.normalizeEvent(data, userId);
    },

    async createEvent(eventData, coverFile = null) {
        let { 
            invited_user_ids, 
            is_secret_santa, 
            secret_santa_data, 
            workflow_steps, 
            offerings, 
            dress_code, 
            etiquette_notes,
            audience,
            invite_methods,
            reminders,
            guests_allowed,
            ...insertData 
        } = eventData;
        
        let coverImageUrl = insertData.cover_photo_url || insertData.cover_image;

        if (coverFile) {
            const fileName = `${insertData.family_space_id}/events/cover_${Date.now()}_${coverFile.originalname || 'image'}`;
            coverImageUrl = await uploadFile(BUCKETS.MEDIA, fileName, coverFile.buffer, coverFile.mimetype);
        }

        // Pack ritual/workflow metadata into description using hidden tags
        const ritualMetadata = {
            workflow_steps: workflow_steps ? (typeof workflow_steps === 'string' ? JSON.parse(workflow_steps) : workflow_steps) : [],
            offerings: offerings ? (typeof offerings === 'string' ? JSON.parse(offerings) : offerings) : [],
            dress_code,
            etiquette_notes
        };
        
        const metaTag = `\n\n<!--RITUAL_DATA:${JSON.stringify(ritualMetadata)}-->`;
        insertData.description = (insertData.description || '') + metaTag;

        const { data: event, error: eventError } = await supabase
            .from('events')
            .insert([{
                ...insertData,
                audience: audience || 'Entire family',
                invite_methods: invite_methods ? (typeof invite_methods === 'string' ? JSON.parse(invite_methods) : invite_methods) : { notification: true, email: false },
                reminders: reminders ? (typeof reminders === 'string' ? JSON.parse(reminders) : reminders) : ['1d before'],
                guests_allowed: guests_allowed || 0,
                cover_photo_url: coverImageUrl,
                cover_image: coverImageUrl,
                created_at: new Date().toISOString()
            }])
            .select()
            .single();

        if (eventError) throw eventError;

        try {
            if (insertData.family_space_id) {
                const { dispatchNotification } = await import('./notificationService.js');
                dispatchNotification(
                    insertData.family_space_id,
                    'Event reminder',
                    `New event: ${event.title || event.name || 'Family event'}`,
                    event.description
                        ? String(event.description).replace(/<!--RITUAL_DATA:[\s\S]*?-->/g, '').trim().slice(0, 240)
                        : 'A new family event was created.',
                    undefined,
                    { channel: 'events' }
                ).catch(() => {});
            }
        } catch (_) { /* non-blocking */ }

        // Handle Secret Santa initialization
        if (is_secret_santa === true || is_secret_santa === 'true') {
            const santa = typeof secret_santa_data === 'string' ? JSON.parse(secret_santa_data) : secret_santa_data;
            if (santa) {
                const { data: exchange, error: ssError } = await supabase
                    .from('secret_santa_exchanges')
                    .insert({
                        event_id: event.id,
                        budget_min: santa.budgetMin,
                        budget_max: santa.budgetMax,
                        gift_deadline: santa.giftDeadline,
                        notes: santa.notes,
                        anonymous_mode: santa.anonymousMode,
                        is_locked: santa.isLocked || false
                    })
                    .select()
                    .single();
                
                if (ssError) {
                    console.error('Secret Santa initialization error:', ssError);
                } else if (santa.pairings && santa.pairings.length > 0) {
                    // Save specific pairings if they were finalized in the preview
                    const pairingsToInsert = santa.pairings.map(p => ({
                        exchange_id: exchange.id,
                        giver_id: p.giver_id,
                        receiver_id: p.receiver_id
                    }));
                    
                    const { error: pError } = await supabase.from('secret_santa_pairings').insert(pairingsToInsert);
                    if (pError) {
                        console.error('Pairing insertion error:', pError);
                    } else {
                        // Mark as drawn since pairings are already set
                        await supabase.from('secret_santa_exchanges').update({ is_drawn: true }).eq('id', exchange.id);
                    }
                }
            }
        }

        // Handle Invitations
        if (invited_user_ids) {
            const ids = Array.isArray(invited_user_ids) ? invited_user_ids : JSON.parse(invited_user_ids);
            if (ids.length > 0) {
                const rsvps = ids.map(uid => ({
                    event_id: event.id,
                    user_id: uid,
                    status: 'pending'
                }));
                const { error: rsvpError } = await supabase.from('event_rsvps').insert(rsvps);
                if (rsvpError) console.error('RSVP insertion error:', rsvpError);
            }
        }

        return event;
    },

    async rsvpEvent(eventId, userId, status) {
        const { data, error } = await supabase
            .from('event_rsvps')
            .upsert([{
                event_id: eventId,
                user_id: userId,
                status,
                responded_at: new Date().toISOString()
            }], { onConflict: 'event_id,user_id' })
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async updateEvent(id, eventData, coverFile = null) {
        let { invited_user_ids, ...updateData } = eventData;
        let coverImageUrl = updateData.cover_photo_url || updateData.cover_image;

        if (coverFile) {
            const fileName = `${updateData.family_space_id || 'global'}/events/cover_${Date.now()}_${coverFile.originalname || 'image'}`;
            coverImageUrl = await uploadFile(BUCKETS.MEDIA, fileName, coverFile.buffer, coverFile.mimetype);
        }

        // 1. Separate Account IDs from Person IDs
        const ids = Array.isArray(invited_user_ids) ? invited_user_ids : JSON.parse(invited_user_ids || '[]');

        let accountIds = [];
        let personIds = [];
        if (ids.length > 0) {
            const { data: users } = await supabase.from('users').select('id').in('id', ids);
            accountIds = (users || []).map(u => u.id);
            personIds = ids.filter(id => !accountIds.includes(id));
        }

        // 2. Metadata Hack: Store person IDs in description to ensure they "stick"
        let cleanDescription = (updateData.description || '').replace(/<!--INVITED_PERSONS:.*-->/g, '').trim();
        if (personIds.length > 0) {
            cleanDescription += ` <!--INVITED_PERSONS:${personIds.join(',')}-->`;
        }
        updateData.description = cleanDescription;

        const { data, error } = await supabase
            .from('events')
            .update({
                ...updateData,
                cover_photo_url: coverImageUrl,
                cover_image: coverImageUrl
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // 3. Handle Account Invitations Sync (Standard DB Table)
        if (accountIds.length >= 0) {
            const { data: currentRSVPs } = await supabase.from('event_rsvps').select('user_id').eq('event_id', id);
            const currentIds = (currentRSVPs || []).map(r => r.user_id);

            const newIds = accountIds.filter(uid => !currentIds.includes(uid));
            if (newIds.length > 0) {
                const rsvpsToInsert = newIds.map(uid => ({ event_id: id, user_id: uid, status: 'pending' }));
                await supabase.from('event_rsvps').insert(rsvpsToInsert);
            }

            const idsToRemove = currentIds.filter(uid => !accountIds.includes(uid));
            if (idsToRemove.length > 0) {
                await supabase.from('event_rsvps').delete().eq('event_id', id).in('user_id', idsToRemove).eq('status', 'pending');
            }
        }

        return data; // return raw updated event (no joined rsvps on update)
    },

    async deleteEvent(id) {
        const { error } = await supabase
            .from('events')
            .delete()
            .eq('id', id);

        if (error) throw error;
        return true;
    }
};
