import { supabase } from '../../config/supabaseClient.js';

const missingMessageColumn = (error) => {
    const match = String(error?.message || '').match(/Could not find the '([^']+)' column of 'marketplace_messages'/i);
    return match ? match[1] : null;
};

const insertMarketplaceMessage = async (row) => {
    let payload = { ...row };
    for (let attempt = 0; attempt < 8; attempt++) {
        const { data, error } = await supabase
            .from('marketplace_messages')
            .insert([payload])
            .select()
            .single();
        if (!error) return data;
        const missing = missingMessageColumn(error);
        if (!missing) throw error;
        delete payload[missing];
        console.warn(`marketplace_messages is missing column ${missing}; retrying insert without it`);
    }
    throw new Error('Could not send message: marketplace_messages schema mismatch');
};

const normalizeMessage = (row) => {
    if (!row) return row;
    const text = row.message || row.content || '';
    return { ...row, message: text, content: text };
};

/**
 * Send a new message
 * POST /api/marketplace/chat/send
 */
export const sendMessage = async (req, res) => {
    try {
        const { id: sender_id } = req.user;
        const { listing_id, receiver_id } = req.body;
        const text = String(req.body.message ?? req.body.content ?? req.body.text ?? '').trim();
        let { family_space_id } = req.body;

        if (!listing_id || !receiver_id || !text) {
            return res.status(400).json({ error: 'listing_id, receiver_id, and message are required' });
        }

        if (!family_space_id) {
            const { data: listing } = await supabase
                .from('marketplace_listings')
                .select('family_space_id, seller_id')
                .eq('id', listing_id)
                .maybeSingle();
            family_space_id = listing?.family_space_id || null;
        }

        // Live UAT has NOT NULL `content`; newer schema uses `message`. Write both.
        const data = await insertMarketplaceMessage({
            family_space_id: family_space_id || null,
            listing_id,
            sender_id,
            receiver_id,
            message: text,
            content: text,
            read_status: false
        });

        res.status(201).json({ message: 'Message sent successfully', data: normalizeMessage(data) });
    } catch (err) {
        console.error('Error sending message:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
};

/**
 * Get full chat history between logged in user and another user for a specific listing
 * GET /api/app/marketplace/chat/history
 */
export const getChatHistory = async (req, res) => {
    try {
        const { id: current_user_id } = req.user;
        const { family_space_id, listing_id, other_user_id } = req.query;

        if (!listing_id || !other_user_id) {
            return res.status(400).json({ error: 'listing_id and other_user_id are required' });
        }

        // Fetch all messages between these two users for this listing
        let query = supabase
            .from('marketplace_messages')
            .select('*')
            .eq('listing_id', listing_id)
            .or(`and(sender_id.eq.${current_user_id},receiver_id.eq.${other_user_id}),and(sender_id.eq.${other_user_id},receiver_id.eq.${current_user_id})`)
            .order('created_at', { ascending: true });

        if (family_space_id) {
            query = query.eq('family_space_id', family_space_id);
        }

        const { data: messages, error } = await query;
        if (error) throw error;
        const normalized = (messages || []).map(normalizeMessage);

        // Mark unread messages sent by the other user as read asynchronously
        const unreadMessageIds = normalized
            .filter(msg => msg.receiver_id === current_user_id && !msg.read_status)
            .map(msg => msg.id);

        if (unreadMessageIds.length > 0) {
            supabase
                .from('marketplace_messages')
                .update({ read_status: true })
                .in('id', unreadMessageIds)
                .then(({ error }) => {
                    if (error) console.error('Failed to mark messages as read:', error);
                });
        }

        res.status(200).json({ data: normalized });
    } catch (err) {
        console.error('Error fetching chat history:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
};

/**
 * Get inbox list of all recent conversations
 * GET /api/app/marketplace/chat/conversations
 */
export const getConversations = async (req, res) => {
    try {
        const { id: current_user_id } = req.user;
        const { family_space_id } = req.query;

        let query = supabase
            .from('marketplace_messages')
            .select(`
                *,
                listing:marketplace_listings (id, title, image_urls)
            `)
            .or(`sender_id.eq.${current_user_id},receiver_id.eq.${current_user_id}`)
            .order('created_at', { ascending: false });

        if (family_space_id) {
            query = query.eq('family_space_id', family_space_id);
        }

        const { data: messages, error } = await query;

        if (error) throw error;

        // Extract a unique list of other users we are talking to
        const otherUserIdsSet = new Set();
        messages.forEach(m => {
            if (m.sender_id !== current_user_id) otherUserIdsSet.add(m.sender_id);
            if (m.receiver_id !== current_user_id) otherUserIdsSet.add(m.receiver_id);
        });

        // Fetch details for all "other users" at once
        let usersMap = {};
        if (otherUserIdsSet.size > 0) {
            const { data: usersData, error: usersError } = await supabase
                .from('users')
                .select('id, first_name, last_name, email')
                .in('id', Array.from(otherUserIdsSet));
            
            if (!usersError && usersData) {
                usersData.forEach(u => {
                    usersMap[u.id] = u;
                });
            }
        }

        // Group messages by listing_id + other_user_id
        const conversationsMap = {};

        messages.forEach(msg => {
            const other_user_id = msg.sender_id === current_user_id ? msg.receiver_id : msg.sender_id;
            const convoKey = `${msg.listing_id}_${other_user_id}`;

            if (!conversationsMap[convoKey]) {
                const otherUser = usersMap[other_user_id] || { id: other_user_id, first_name: 'Unknown', last_name: 'User' };
                const listing = msg.listing || { id: msg.listing_id, title: 'Unknown Listing', image_urls: [] };
                
                conversationsMap[convoKey] = {
                    other_user: {
                        id: otherUser.id,
                        name: `${otherUser.first_name} ${otherUser.last_name}`,
                        email: otherUser.email
                    },
                    listing: {
                        id: listing.id,
                        title: listing.title,
                        thumbnail: listing.image_urls && listing.image_urls.length > 0 ? listing.image_urls[0] : null
                    },
                    latest_message: msg.message || msg.content,
                    latest_timestamp: msg.created_at,
                    unread_count: 0
                };
            }

            // Increment unread count if the current user is the receiver and message is unread
            if (msg.receiver_id === current_user_id && !msg.read_status) {
                conversationsMap[convoKey].unread_count += 1;
            }
        });

        const conversationsList = Object.values(conversationsMap).sort((a, b) => {
            return new Date(b.latest_timestamp) - new Date(a.latest_timestamp);
        });

        res.status(200).json({ data: conversationsList });
    } catch (err) {
        console.error('Error fetching conversations:', err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
};
