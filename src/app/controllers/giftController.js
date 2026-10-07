import { GiftExchangeService, GIFT_STATUSES } from '../../services/giftExchangeService.js';
import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';

/**
 * Setup / update gift-exchange settings on the event (legacy + new fields).
 * Prefer passing settings at create-event time.
 */
export const setupGiftExchange = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { user } = req;
        const {
            budget,
            budget_min,
            budget_max,
            draw_date,
            gift_deadline,
            exclude_same_household,
            notes,
            anonymous_mode
        } = req.body;

        const { data: event, error: eError } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();

        if (eError || !event) return res.status(404).json({ error: 'Event not found' });
        if (event.creator_id !== user.id) {
            return res.status(403).json({ error: 'Only event creator can setup gift exchange' });
        }

        let budgetLabel = budget || null;
        if (!budgetLabel && (budget_min != null || budget_max != null)) {
            budgetLabel = `$${budget_min || 0} - $${budget_max || 0}`;
        }

        const patch = {
            include_gift_exchange: true,
            budget: budgetLabel,
            draw_date: draw_date || null,
            gift_deadline: gift_deadline || null,
            exclude_same_household: exclude_same_household === true || exclude_same_household === 'true'
        };

        const { data: updated, error } = await supabase
            .from('events')
            .update(patch)
            .eq('id', eventId)
            .select()
            .single();

        if (error) throw error;

        // Keep legacy secret_santa_exchanges in sync when that table exists
        try {
            await supabase.from('secret_santa_exchanges').upsert({
                event_id: eventId,
                budget_min: budget_min ?? 0,
                budget_max: budget_max ?? 0,
                gift_deadline: gift_deadline || null,
                notes: notes || null,
                anonymous_mode: anonymous_mode !== false
            }, { onConflict: 'event_id' });
        } catch (_) { /* optional legacy table */ }

        res.status(200).json(updated);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

/**
 * POST /events/:id/gift-exchange/join
 * Body: { preferences }
 */
export const joinGiftExchange = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { preferences } = req.body || {};
        const data = await GiftExchangeService.join({
            eventId,
            userId: req.user.id,
            preferences
        });

        // logActivity is fire-and-forget (returns undefined) — do not .catch() it
        logActivity(
            req.user.id,
            'JOIN_GIFT_EXCHANGE',
            'events',
            eventId,
            req.ip,
            {}
        );

        res.status(201).json({
            message: 'Joined gift exchange successfully',
            participant: data
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

/**
 * POST /events/:id/gift-exchange/draw
 */
export const runDrawing = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const result = await GiftExchangeService.draw({
            eventId,
            actorId: req.user.id
        });
        res.json(result);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

/**
 * GET /events/:id/gift-exchange/my-recipient
 * (also served as /my-pairing for backward compatibility)
 */
export const getMyRecipient = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const data = await GiftExchangeService.getMyRecipient({
            eventId,
            userId: req.user.id
        });
        res.json(data);
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

/** @deprecated alias — prefer getMyRecipient */
export const getMyPairing = getMyRecipient;

/**
 * PATCH /events/:id/gift-exchange/status
 * Body: { status: 'Delivered', trigger_feed_summary: true }
 */
export const updateGiftStatus = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { status, trigger_feed_summary } = req.body || {};
        const data = await GiftExchangeService.updateGiftStatus({
            eventId,
            userId: req.user.id,
            status,
            triggerFeedSummary: trigger_feed_summary
        });
        const { feed_post, ...participant } = data;
        res.json({
            message: 'Gift status updated',
            gift_status: participant.gift_status,
            participant,
            feed_post: feed_post || null,
            feed_summary_triggered: Boolean(feed_post),
            valid_statuses: GIFT_STATUSES
        });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};

/**
 * Legacy wishlist endpoint — maps to preferences on join row.
 */
export const updateWishlist = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { wishlist_text, preferences } = req.body || {};
        const text = preferences ?? wishlist_text ?? '';
        const data = await GiftExchangeService.join({
            eventId,
            userId: req.user.id,
            preferences: text
        });
        res.json({ message: 'Wishlist updated', content: data.preferences });
    } catch (err) {
        res.status(err.status || 500).json({ error: err.message });
    }
};
