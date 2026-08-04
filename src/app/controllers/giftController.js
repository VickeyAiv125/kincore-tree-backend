import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';
import { createNotification } from '../../shared/controllers/notificationController.js';

/**
 * Setup or Update Gift Exchange rules
 */
export const setupGiftExchange = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { budget_min, budget_max, gift_deadline, notes, anonymous_mode } = req.body;
        const { user } = req;

        // Verify event exists and user is creator
        const { data: event, error: eError } = await supabase
            .from('events')
            .select('*')
            .eq('id', eventId)
            .single();

        if (eError || !event) return res.status(404).json({ error: 'Event not found' });
        if (event.creator_id !== user.id) return res.status(403).json({ error: 'Only event creator can setup gift exchange' });

        const { data, error } = await supabase
            .from('secret_santa_exchanges')
            .upsert({
                event_id: eventId,
                budget_min,
                budget_max,
                gift_deadline,
                notes,
                anonymous_mode
            }, { onConflict: 'event_id' })
            .select()
            .single();

        if (error) throw error;
        res.status(200).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Perform Secret Santa Drawing
 */
export const runDrawing = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { user } = req;

        console.log(`[GiftExchange] Initiating draw for Event: ${eventId}`);

        // 1. Get exchange info
        const { data: exchange, error: xError } = await supabase
            .from('secret_santa_exchanges')
            .select('*')
            .eq('event_id', eventId)
            .maybeSingle();

        if (xError) throw xError;
        if (!exchange) {
            return res.status(404).json({ error: 'Gift exchange setup not found for this event. Please run the setup API first.' });
        }

        if (exchange.is_drawn) {
            return res.status(400).json({ error: 'Drawing already completed for this event.' });
        }

        // 2. Get all 'going' participants
        const { data: participants, error: pError } = await supabase
            .from('event_rsvps')
            .select('user_id')
            .eq('event_id', eventId)
            .eq('status', 'going');

        if (pError) throw pError;
        if (participants.length < 2) return res.status(400).json({ error: 'At least 2 participants needed for drawing' });

        const userIds = participants.map(p => p.user_id);

        // 3. Simple Shuffle & Pair algorithm
        const shuffled = [...userIds].sort(() => Math.random() - 0.5);
        const pairings = [];
        for (let i = 0; i < shuffled.length; i++) {
            const giverId = shuffled[i];
            const receiverId = shuffled[(i + 1) % shuffled.length]; // Wrap around
            pairings.push({
                exchange_id: exchange.id,
                giver_id: giverId,
                receiver_id: receiverId
            });
        }

        // 4. Save pairings
        const { error: iError } = await supabase.from('secret_santa_pairings').insert(pairings);
        if (iError) throw iError;

        // 5. Mark as drawn
        await supabase.from('secret_santa_exchanges').update({ is_drawn: true }).eq('id', exchange.id);

        // 6. Send Notifications to all participants
        for (const userId of userIds) {
            await createNotification({
                user_id: userId,
                type: 'GIFT_DRAWN',
                title: 'Secret Santa drawing completed!',
                message: 'You have been assigned a recipient for the gift exchange. Check your assignment now!',
                metadata: { event_id: eventId, exchange_id: exchange.id }
            });
        }

        res.json({ message: 'Drawing completed successfully', total_pairs: pairings.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get My Assignment (who am I giving to?)
 */
export const getMyPairing = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { user } = req;

        console.log(`[GiftExchange] Fetching pairing for User: ${user.id} on Event: ${eventId}`);

        // Get exchange ID first
        const { data: exchange, error: xError } = await supabase
            .from('secret_santa_exchanges')
            .select('id')
            .eq('event_id', eventId)
            .maybeSingle();

        if (xError) throw xError;
        if (!exchange) {
            return res.status(404).json({ error: 'Gift exchange setup not found for this event.' });
        }

        const { data, error } = await supabase
            .from('secret_santa_pairings')
            .select(`
                receiver:users!secret_santa_pairings_receiver_id_fkey(id, first_name, last_name, avatar_url)
            `)
            .eq('exchange_id', exchange.id)
            .eq('giver_id', user.id)
            .maybeSingle();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'No pairing found for you in this exchange. Has the drawing happened?' });

        // Note: Filters wishlist for the receiver only
        const { data: wishlist } = await supabase
            .from('secret_santa_wishlists')
            .select('content')
            .eq('exchange_id', exchange.id)
            .eq('user_id', data.receiver.id)
            .maybeSingle();

        res.json({
            recipient_id: data.receiver.id,
            recipient_name: `${data.receiver.first_name} ${data.receiver.last_name}`,
            recipient_avatar: data.receiver.avatar_url,
            wishlist: wishlist?.content || 'No wishlist provided yet'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update My Wishlist
 */
export const updateWishlist = async (req, res) => {
    try {
        const { id: eventId } = req.params;
        const { wishlist_text } = req.body;
        const { user } = req;

        const { data: exchange } = await supabase.from('secret_santa_exchanges').select('id').eq('event_id', eventId).single();
        if (!exchange) return res.status(404).json({ error: 'Exchange not found' });

        const { data, error } = await supabase
            .from('secret_santa_wishlists')
            .upsert({
                exchange_id: exchange.id,
                user_id: user.id,
                content: wishlist_text,
                updated_at: new Date().toISOString()
            }, { onConflict: 'exchange_id, user_id' })
            .select()
            .single();

        if (error) throw error;
        res.json({ message: 'Wishlist updated', content: data.content });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
