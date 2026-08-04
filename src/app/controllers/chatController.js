import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';

/**
 * GET Rooms - List all conversations for the current user
 * Includes last message and participant details
 */
export const getRooms = async (req, res) => {
    try {
        const { user } = req;
        // Make sure we have the user ID correctly
        const userId = user.id;

        // 1. Get room IDs the user is part of
        const { data: participations, error: pError } = await supabase
            .from('chat_room_participants')
            .select('room_id')
            .eq('user_id', userId);

        if (pError) throw pError;
        const roomIds = (participations || []).map(p => p.room_id);

        if (roomIds.length === 0) return res.json([]);

        // 2. Fetch room details
        const { data: rooms, error: rError } = await supabase
            .from('chat_rooms')
            .select(`
                *,
                chat_room_participants (
                    user_id, 
                    users:user_id (id, first_name, last_name, avatar_url)
                ),
                chat_messages (
                    content,
                    created_at
                )
            `)
            .in('id', roomIds);

        if (rError) throw rError;

        // 3. Format and sort
        const formatted = (rooms || []).map(room => {
            const sortedMsgs = (room.chat_messages || []).sort(
                (a, b) => new Date(b.created_at) - new Date(a.created_at)
            );
            const lastMsg = sortedMsgs[0] || null;

            let otherUser = null;
            if (!room.is_group) {
                // Find someone who is NOT the current user
                const other = room.chat_room_participants.find(p => p.user_id !== userId);
                // If you messaged yourself (test case), "other" might be null or same as you
                otherUser = other?.users || room.chat_room_participants[0]?.users || null;
            }

            return {
                id: room.id,
                name: room.name || (otherUser ? `${otherUser.first_name || 'User'} ${otherUser.last_name || ''}` : 'Unknown Room'),
                avatar_url: otherUser?.avatar_url || null,
                is_group: room.is_group,
                last_message: lastMsg?.content || 'No messages yet',
                last_message_time: lastMsg?.created_at || room.created_at,
                family_space_id: room.family_space_id
            };
        });

        // Filter by family_space_id in code if provided (safer than SQL during debugging)
        const { family_space_id } = req.query;
        const finalResults = family_space_id
            ? formatted.filter(r => r.family_space_id === family_space_id)
            : formatted;

        // Final sort: latest conversations at the top
        finalResults.sort((a, b) => new Date(b.last_message_time) - new Date(a.last_message_time));

        res.json(finalResults);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET Messages - Fetch history for a room
 */
export const getMessages = async (req, res) => {
    try {
        const { roomId } = req.params;
        const { page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        const { data, error } = await supabase
            .from('chat_messages')
            .select(`
                *,
                users:sender_id (id, first_name, last_name, avatar_url)
            `)
            .eq('room_id', roomId)
            .order('created_at', { ascending: false })
            .range(offset, offset + parseInt(limit) - 1);

        if (error) throw error;

        // Reverse to show chronological for UI if needed, or keep desc for infinite scroll
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST Send Message
 * Accepts: room_id OR recipient_id (for new DMs)
 */
export const sendMessage = async (req, res) => {
    try {
        const { user } = req;
        const { room_id, recipient_id, content, media_url, family_space_id } = req.body;

        let targetRoomId = room_id;

        // If no room_id, handle DM creation
        if (!targetRoomId && recipient_id) {
            targetRoomId = await getOrCreateDM(user.id, recipient_id, family_space_id);
        }

        if (!targetRoomId) return res.status(400).json({ error: 'room_id or recipient_id required' });

        const { data, error } = await supabase
            .from('chat_messages')
            .insert({
                room_id: targetRoomId,
                sender_id: user.id,
                content,
                media_url
            })
            .select(`
                *,
                users:sender_id (id, first_name, last_name, avatar_url)
            `)
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Helper: Get or Create a DM room between two users
 */
async function getOrCreateDM(userId, recipientId, familySpaceId) {
    // 1. Find if a DM exists
    // This is a bit complex in Supabase without a custom RPC, 
    // but we can find rooms where both are participants and is_group=false

    const { data: rooms, error } = await supabase
        .rpc('find_common_dm_room', { user_a: userId, user_b: recipientId });

    if (rooms && rooms.length > 0) return rooms[0].id;

    // 2. Create new DM room
    const { data: newRoom, error: rError } = await supabase
        .from('chat_rooms')
        .insert({ family_space_id: familySpaceId, is_group: false })
        .select()
        .single();

    if (rError) throw rError;

    // 3. Add participants (de-duplicate if messaging self)
    const participants = [{ room_id: newRoom.id, user_id: userId }];
    if (userId !== recipientId) {
        participants.push({ room_id: newRoom.id, user_id: recipientId });
    }

    const { error: pError } = await supabase
        .from('chat_room_participants')
        .insert(participants);

    if (pError) throw pError;

    return newRoom.id;
}
