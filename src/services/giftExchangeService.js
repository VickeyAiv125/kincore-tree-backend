import { supabase } from '../config/supabaseClient.js';
import { createNotification } from '../shared/controllers/notificationController.js';

export const GIFT_STATUSES = ['Not Started', 'Purchased', 'Shipped', 'Delivered'];

const toBool = (value) => value === true || value === 'true' || value === '1' || value === 1;

const fisherYates = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

/**
 * Build userId -> householdKey map using spouse links in the family space.
 * Users with no person/spouse stay in their own singleton household.
 */
export const buildHouseholdMap = async (familySpaceId, userIds) => {
    const map = new Map();
    userIds.forEach((id) => map.set(id, id));
    if (!familySpaceId || !userIds.length) return map;

    const { data: persons } = await supabase
        .from('persons')
        .select('id, claimed_by')
        .eq('family_space_id', familySpaceId)
        .in('claimed_by', userIds);

    const personToUser = new Map();
    (persons || []).forEach((p) => {
        if (p.claimed_by) personToUser.set(p.id, p.claimed_by);
    });
    const personIds = [...personToUser.keys()];
    if (!personIds.length) return map;

    const { data: spouses } = await supabase
        .from('person_relations')
        .select('person_id_1, person_id_2')
        .eq('relation_type', 'spouse')
        .or(
            `person_id_1.in.(${personIds.join(',')}),person_id_2.in.(${personIds.join(',')})`
        );

    const parent = new Map();
    const find = (x) => {
        if (!parent.has(x)) parent.set(x, x);
        if (parent.get(x) !== x) parent.set(x, find(parent.get(x)));
        return parent.get(x);
    };
    const union = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(ra, rb);
    };

    userIds.forEach((id) => find(id));

    (spouses || []).forEach((rel) => {
        const u1 = personToUser.get(rel.person_id_1);
        const u2 = personToUser.get(rel.person_id_2);
        if (u1 && u2 && userIds.includes(u1) && userIds.includes(u2)) {
            union(u1, u2);
        }
    });

    userIds.forEach((id) => map.set(id, find(id)));
    return map;
};

/**
 * Closed-loop derangement: A→B→C→A. No self-assignments.
 * Optionally forbid same-household pairs. Retries with reshuffles.
 */
export const createGiftDerangement = (userIds, householdMap = null, maxAttempts = 200) => {
    if (userIds.length < 2) {
        throw new Error('At least 2 participants are required for the gift draw');
    }

    const sameHousehold = (a, b) => {
        if (!householdMap) return false;
        return householdMap.get(a) === householdMap.get(b);
    };

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const shuffled = fisherYates(userIds);
        const pairs = [];
        let valid = true;

        for (let i = 0; i < shuffled.length; i += 1) {
            const giverId = shuffled[i];
            const recipientId = shuffled[(i + 1) % shuffled.length];
            if (giverId === recipientId) {
                valid = false;
                break;
            }
            if (sameHousehold(giverId, recipientId)) {
                valid = false;
                break;
            }
            pairs.push({ user_id: giverId, recipient_id: recipientId });
        }

        if (valid) return pairs;
    }

    throw new Error(
        householdMap
            ? 'Could not produce a valid draw with household exclusions. Add more participants or disable exclude_same_household.'
            : 'Could not produce a valid gift draw. Please try again.'
    );
};

const DECLINED_RSVP = new Set(['declined', 'not_going', 'no', 'cancelled', 'canceled']);

const addIds = (set, rows, key = 'user_id') => {
    (rows || []).forEach((row) => {
        if (row?.[key]) set.add(row[key]);
    });
};

/**
 * People who can be drawn: gift-exchange rows, event RSVPs / invites,
 * then family members when nobody was enrolled through the join API.
 */
const resolveDrawUserIds = async (event) => {
    const ids = new Set();
    const declined = new Set();

    const { data: giftRows, error: giftErr } = await supabase
        .from('gift_exchange_participants')
        .select('user_id')
        .eq('event_id', event.id);
    if (giftErr) throw giftErr;
    addIds(ids, giftRows);

    const { data: rsvps, error: rsvpErr } = await supabase
        .from('event_rsvps')
        .select('user_id, status')
        .eq('event_id', event.id);
    if (rsvpErr) throw rsvpErr;
    (rsvps || []).forEach((row) => {
        if (!row.user_id) return;
        const status = String(row.status || '').toLowerCase();
        if (DECLINED_RSVP.has(status)) declined.add(row.user_id);
        else ids.add(row.user_id);
    });

    const invited = String(event.description || '').match(/<!--INVITED_PERSONS:([^>]*)-->/);
    const personIds = invited?.[1]
        ? invited[1].split(',').map((id) => id.trim()).filter(Boolean)
        : [];
    if (personIds.length) {
        const { data: persons } = await supabase
            .from('persons')
            .select('claimed_by')
            .in('id', personIds);
        addIds(ids, persons, 'claimed_by');
    }

    declined.forEach((id) => ids.delete(id));
    if (ids.size >= 2) return [...ids];

    if (ids.size === 0 && event.family_space_id) {
        const { data: members } = await supabase
            .from('family_memberships')
            .select('user_id, status')
            .eq('family_space_id', event.family_space_id);
        (members || []).forEach((row) => {
            const status = String(row.status || 'active').toLowerCase();
            if (row.user_id && !['removed', 'inactive', 'banned', 'left'].includes(status)) {
                ids.add(row.user_id);
            }
        });

        if (ids.size < 2) {
            const { data: claimed } = await supabase
                .from('persons')
                .select('claimed_by')
                .eq('family_space_id', event.family_space_id)
                .not('claimed_by', 'is', null);
            addIds(ids, claimed, 'claimed_by');
        }
    }

    declined.forEach((id) => ids.delete(id));
    return [...ids];
};

export const GiftExchangeService = {
    async getEventOrThrow(eventId) {
        const { data: event, error } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();
        if (error || !event) {
            const err = new Error('Event not found');
            err.status = 404;
            throw err;
        }
        return event;
    },

    async assertGiftExchangeEnabled(event) {
        if (!event.include_gift_exchange) {
            const err = new Error('Gift exchange is not enabled for this event');
            err.status = 400;
            throw err;
        }
    },

    async join({ eventId, userId, preferences }) {
        const event = await this.getEventOrThrow(eventId);
        await this.assertGiftExchangeEnabled(event);

        if (event.gift_draw_completed) {
            const err = new Error('Gift draw already completed. Joining is closed.');
            err.status = 400;
            throw err;
        }

        const { data, error } = await supabase
            .from('gift_exchange_participants')
            .upsert(
                {
                    event_id: eventId,
                    user_id: userId,
                    preferences: preferences != null ? String(preferences) : null,
                    gift_status: 'Not Started',
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'event_id,user_id' }
            )
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    async draw({ eventId, actorId, force = false }) {
        const event = await this.getEventOrThrow(eventId);
        await this.assertGiftExchangeEnabled(event);

        const isAdmin = actorId && (
            event.creator_id === actorId
        );
        // Also allow family admins via memberships
        let isFamilyAdmin = false;
        if (actorId && event.family_space_id) {
            const { data: mem } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('family_space_id', event.family_space_id)
                .eq('user_id', actorId)
                .maybeSingle();
            const role = String(mem?.role || '').toLowerCase();
            isFamilyAdmin = ['owner', 'admin', 'family-admin', 'co-admin'].includes(role);
        }

        if (actorId && !isAdmin && !isFamilyAdmin && !force) {
            const err = new Error('Only the event admin can run the gift draw');
            err.status = 403;
            throw err;
        }

        if (event.gift_draw_completed && !force) {
            const err = new Error('Drawing already completed for this event');
            err.status = 400;
            throw err;
        }

        const userIds = await resolveDrawUserIds(event);
        if (userIds.length < 2) {
            const err = new Error('At least 2 participants must join before the draw');
            err.status = 400;
            throw err;
        }

        const enrolled = userIds.map((user_id) => ({
            event_id: eventId,
            user_id,
            gift_status: 'Not Started',
            updated_at: new Date().toISOString()
        }));
        const { error: enrollErr } = await supabase
            .from('gift_exchange_participants')
            .upsert(enrolled, { onConflict: 'event_id,user_id', ignoreDuplicates: true });
        if (enrollErr) throw enrollErr;
        let householdMap = null;
        if (event.exclude_same_household) {
            householdMap = await buildHouseholdMap(event.family_space_id, userIds);
        }

        const pairs = createGiftDerangement(userIds, householdMap);

        for (const pair of pairs) {
            const { error: uErr } = await supabase
                .from('gift_exchange_participants')
                .update({
                    recipient_id: pair.recipient_id,
                    updated_at: new Date().toISOString()
                })
                .eq('event_id', eventId)
                .eq('user_id', pair.user_id);
            if (uErr) throw uErr;
        }

        const { error: eErr } = await supabase
            .from('events')
            .update({ gift_draw_completed: true })
            .eq('id', eventId);
        if (eErr) throw eErr;

        for (const userId of userIds) {
            try {
                await createNotification({
                    user_id: userId,
                    type: 'GIFT_DRAWN',
                    title: 'Gift exchange draw complete!',
                    message: `The gift draw for "${event.title}" is ready. Check who you are gifting.`,
                    metadata: { event_id: eventId }
                });
            } catch (_) { /* non-blocking */ }
        }

        return {
            message: 'Drawing completed successfully',
            total_pairs: pairs.length,
            isDrawCompleted: true
        };
    },

    async getMyRecipient({ eventId, userId }) {
        const event = await this.getEventOrThrow(eventId);
        await this.assertGiftExchangeEnabled(event);

        if (!event.gift_draw_completed) {
            const err = new Error('Gift draw has not been completed yet');
            err.status = 404;
            throw err;
        }

        const { data: row, error } = await supabase
            .from('gift_exchange_participants')
            .select(`
                gift_status,
                preferences,
                recipient:users!gift_exchange_participants_recipient_id_fkey(
                    id, first_name, last_name, avatar_url
                )
            `)
            .eq('event_id', eventId)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;
        if (!row || !row.recipient) {
            const err = new Error('No recipient assignment found for you in this exchange');
            err.status = 404;
            throw err;
        }

        // Recipient's wishlist/preferences (what they wrote when joining)
        const { data: recipientPrefs } = await supabase
            .from('gift_exchange_participants')
            .select('preferences')
            .eq('event_id', eventId)
            .eq('user_id', row.recipient.id)
            .maybeSingle();

        const r = row.recipient;
        return {
            recipient_id: r.id,
            recipient_name: `${r.first_name || ''} ${r.last_name || ''}`.trim() || 'Member',
            recipient_avatar: r.avatar_url || null,
            preferences: recipientPrefs?.preferences || null,
            gift_status: row.gift_status || 'Not Started'
        };
    },

    async updateGiftStatus({ eventId, userId, status, triggerFeedSummary = false }) {
        const normalized = String(status || '').trim();
        if (!GIFT_STATUSES.includes(normalized)) {
            const err = new Error(`Invalid status. Valid: ${GIFT_STATUSES.join(', ')}`);
            err.status = 400;
            throw err;
        }

        const event = await this.getEventOrThrow(eventId);
        await this.assertGiftExchangeEnabled(event);

        if (!event.gift_draw_completed) {
            const err = new Error('Gift draw has not been completed yet');
            err.status = 400;
            throw err;
        }

        const { data, error } = await supabase
            .from('gift_exchange_participants')
            .update({
                gift_status: normalized,
                updated_at: new Date().toISOString()
            })
            .eq('event_id', eventId)
            .eq('user_id', userId)
            .not('recipient_id', 'is', null)
            .select('id, event_id, user_id, recipient_id, gift_status, preferences')
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            const err = new Error('No active gift assignment found for you');
            err.status = 404;
            throw err;
        }

        let feed_post = null;
        const shouldPostSummary = toBool(triggerFeedSummary) && normalized === 'Delivered';
        if (shouldPostSummary) {
            feed_post = await this.createDeliveryFeedSummary({
                event,
                giverId: userId,
                recipientId: data.recipient_id
            });
        }

        return { ...data, feed_post };
    },

    /**
     * Create a family feed post summarizing a completed gift delivery.
     */
    async createDeliveryFeedSummary({ event, giverId, recipientId }) {
        if (!event?.family_space_id) return null;

        const ids = [giverId, recipientId].filter(Boolean);
        const { data: users } = await supabase
            .from('users')
            .select('id, first_name, last_name')
            .in('id', ids);

        const nameOf = (id) => {
            const u = (users || []).find((row) => row.id === id);
            if (!u) return 'A family member';
            return `${u.first_name || ''} ${u.last_name || ''}`.trim() || 'A family member';
        };

        const giverName = nameOf(giverId);
        const recipientName = recipientId ? nameOf(recipientId) : 'their recipient';
        const title = event.title || 'Gift Exchange';
        const content = [
            `🎁 Gift delivered for "${title}"!`,
            `${giverName} has delivered their gift exchange present to ${recipientName}.`,
            event.participation_scope
                ? `Participation scope: ${event.participation_scope}.`
                : null
        ].filter(Boolean).join('\n');

        const { data: post, error } = await supabase
            .from('posts')
            .insert({
                user_id: giverId,
                family_space_id: event.family_space_id,
                content,
                post_type: 'text',
                media_urls: null,
                tagged_users: recipientId ? [recipientId] : null,
                visibility: 'family',
                comment_permission: 'friends'
            })
            .select('id, family_space_id, content, post_type, visibility, created_at')
            .single();

        if (error) {
            console.error('[GiftExchange] feed summary post failed:', error.message);
            return null;
        }

        try {
            const { dispatchNotification } = await import('./notificationService.js');
            dispatchNotification(
                event.family_space_id,
                'Gift delivered',
                `Gift delivered for ${title}`,
                content.slice(0, 140)
            ).catch(() => {});
        } catch (_) { /* non-blocking */ }

        return post;
    },

    /**
     * Enrich gift-exchange events with hasJoinedGiftExchange + isDrawCompleted.
     */
    async enrichGiftFlags(events, userId) {
        if (!events?.length || !userId) return events || [];

        const giftEvents = events.filter((e) => e.include_gift_exchange);
        if (!giftEvents.length) return events;

        const ids = giftEvents.map((e) => e.id);
        const { data: joined, error } = await supabase
            .from('gift_exchange_participants')
            .select('event_id')
            .eq('user_id', userId)
            .in('event_id', ids);

        if (error) {
            // Table may not exist until migration is applied
            console.warn('[GiftExchange] enrichGiftFlags:', error.message);
            return events.map((e) => ({
                ...e,
                hasJoinedGiftExchange: false,
                isDrawCompleted: !!e.gift_draw_completed
            }));
        }

        const joinedSet = new Set((joined || []).map((j) => j.event_id));

        return events.map((e) => {
            if (!e.include_gift_exchange) return e;
            return {
                ...e,
                hasJoinedGiftExchange: joinedSet.has(e.id),
                isDrawCompleted: !!e.gift_draw_completed
            };
        });
    },

    /** Cron helper: run draws for events whose draw_date has passed. */
    async runDueDraws() {
        const now = new Date().toISOString();
        const { data: due, error } = await supabase
            .from('events')
            .select('id, title')
            .eq('include_gift_exchange', true)
            .eq('gift_draw_completed', false)
            .not('draw_date', 'is', null)
            .lte('draw_date', now);

        if (error) {
            console.error('[GiftExchange] due-draw query failed:', error.message);
            return { ran: 0, errors: [error.message] };
        }

        let ran = 0;
        const errors = [];
        for (const ev of due || []) {
            try {
                await this.draw({ eventId: ev.id, actorId: null, force: true });
                ran += 1;
                console.log(`[GiftExchange] Auto-draw completed for event ${ev.id} (${ev.title})`);
            } catch (err) {
                errors.push({ event_id: ev.id, error: err.message });
                console.warn(`[GiftExchange] Auto-draw skipped for ${ev.id}:`, err.message);
            }
        }
        return { ran, errors };
    }
};
