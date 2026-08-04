import { supabase } from '../../config/supabaseClient.js';
import { mergeSupportKnowledge, getDefaultSupportKnowledge } from '../../services/supportKnowledgeService.js';

/**
 * GET support knowledge (FAQs, admin guide, videos, contact).
 * Public-to-authenticated consumers; CMS override via platform_settings.
 */
export const getSupportKnowledge = async (_req, res) => {
    try {
        const { data, error } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', 'support_knowledge')
            .maybeSingle();

        if (error && !String(error.message || '').includes('does not exist')) {
            // Fall through to defaults if table missing / RLS weirdness
            console.warn('[getSupportKnowledge]', error.message);
        }

        const knowledge = mergeSupportKnowledge(data?.value || {});
        res.json({ knowledge, source: data?.value ? 'cms' : 'defaults' });
    } catch (err) {
        res.json({ knowledge: getDefaultSupportKnowledge(), source: 'defaults' });
    }
};

/**
 * PATCH support knowledge CMS (Business / Owner / Support).
 */
export const updateSupportKnowledge = async (req, res) => {
    try {
        const incoming = req.body?.knowledge || req.body || {};
        const knowledge = mergeSupportKnowledge(incoming);

        const { data, error } = await supabase
            .from('platform_settings')
            .upsert(
                {
                    key: 'support_knowledge',
                    value: knowledge,
                    updated_at: new Date().toISOString()
                },
                { onConflict: 'key' }
            )
            .select('key, value, updated_at')
            .single();

        if (error) throw error;
        res.json({ message: 'Support knowledge updated', knowledge: data.value, updated_at: data.updated_at });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * List all support tickets.
 */
export const getTickets = async (req, res) => {
    try {
        const { status, priority, category } = req.query;
        let query = supabase.from('support_tickets').select(`
            *,
            user:users!user_id (first_name, last_name, email)
        `);

        if (status) query = query.eq('status', status);
        if (priority) query = query.eq('priority', priority);
        if (category) query = query.eq('category', category);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get ticket messages and details.
 */
export const getTicketDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const { data: ticket, error: ticketError } = await supabase
            .from('support_tickets')
            .select(`
                *,
                user:users!user_id (first_name, last_name, email)
            `)
            .eq('id', id)
            .single();

        if (ticketError) throw ticketError;

        const { data: messages, error: msgError } = await supabase
            .from('ticket_messages')
            .select(`
                *,
                sender:users!sender_id (first_name, last_name, avatar_url)
            `)
            .eq('ticket_id', id)
            .order('created_at', { ascending: true });

        if (msgError) throw msgError;

        res.json({ ...ticket, messages });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Post a reply or internal note.
 */
export const replyToTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { message, is_internal = false, status } = req.body;
        const { user } = req;

        // 1. Insert message
        const { error: msgError } = await supabase
            .from('ticket_messages')
            .insert({
                ticket_id: id,
                sender_id: user.id,
                message,
                is_internal
            });

        if (msgError) throw msgError;

        // 2. Update status if provided
        if (status) {
            await supabase
                .from('support_tickets')
                .update({ status })
                .eq('id', id);
        }

        const { data: ticket } = await supabase
            .from('support_tickets')
            .select('user_id, family_space_id, subject')
            .eq('id', id)
            .maybeSingle();

        if (ticket?.family_space_id && !is_internal) {
            const { dispatchNotification } = await import('../../services/notificationService.js');
            dispatchNotification(
                ticket.family_space_id,
                'Support ticket updated',
                `Support ticket updated: ${ticket.subject || id}`,
                message || 'Your support ticket was updated.',
                undefined,
                { extraUserIds: ticket.user_id ? [ticket.user_id] : [] }
            ).catch(() => {});
        }

        res.status(201).json({ message: 'Reply sent' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
