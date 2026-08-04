import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';

export const submitAbuseReport = async (req, res) => {
    try {
        const { familySpaceId, targetId, targetType, reason, details } = req.body;
        const reporterId = req.user.id;

        if (!familySpaceId || !targetId || !targetType || !reason) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const { data, error } = await supabase
            .from('abuse_reports')
            .insert({
                reporter_id: reporterId,
                target_id: targetId,
                target_type: targetType,
                reason,
                details,
                family_space_id: familySpaceId,
                status: 'pending'
            })
            .select()
            .single();

        if (error) throw error;

        await logActivity(reporterId, 'SUBMIT_ABUSE_REPORT', 'abuse_reports', data.id, req.ip || null, {
            target_type: targetType,
            target_id: targetId,
            reason
        });

        try {
            const { dispatchNotification } = await import('../services/notificationService.js');
            dispatchNotification(
                familySpaceId,
                'Abuse report',
                'New abuse report',
                `${reason}${details ? ` — ${details}` : ''}`,
                undefined,
                { channel: 'abuse' }
            ).catch(() => {});
        } catch (_) { /* non-blocking */ }

        res.status(201).json({ message: 'Report submitted successfully', report: data });
    } catch (err) {
        console.error('>>> SUBMIT ABUSE REPORT ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};
