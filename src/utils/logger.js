import { supabase } from '../config/supabaseClient.js';

/**
 * Centrally log any administrative or critical action.
 * @param {string} actorId - UUID of the user performing the action.
 * @param {string} action - The action name (e.g., 'SUSPEND_USER', 'DELETE_POST').
 * @param {string} targetType - The entity type (e.g., 'users', 'posts').
 * @param {string} targetId - ID of the impacted entity.
 * @param {string} ipAddress - IP address of the requester.
 * @param {object} details - Any additional JSON metadata.
 */
export const logActivity = (actorId, action, targetType, targetId, ipAddress = null, details = {}) => {
    // Fire-and-forget: logging must NEVER cause a 500 on the calling route
    Promise.resolve().then(async () => {
        try {
            const { error } = await supabase.from('audit_logs').insert({
                actor_id: actorId,
                action: action.toUpperCase(),
                target_type: targetType,
                target_id: String(targetId),
                details,
                ip_address: ipAddress
            });
            if (error) console.error('CRITICAL: Failed to write audit log:', error.message);
        } catch (err) {
            console.error('Audit Logger Execution Error:', err.message);
        }

        // Duplicate to System Logs for DevOps visibility (non-blocking)
        logSystemEvent('INFO', 'ADMIN_PANEL', `Admin Action: ${action} on ${targetType}`, {
            user_id: actorId,
            metadata: { target_id: targetId, ip: ipAddress, ...details }
        });
    }).catch(() => {}); // swallow all errors — logging is never critical
};

/**
 * System Logger for DevOps / Admin Logs Explorer
 * @param {string} level - 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL'
 * @param {string} service - e.g., 'AUTH_API', 'BACKGROUND_JOBS', 'WEBHOOK'
 * @param {string} action - Short description of what happened
 * @param {object} options - { user_id, family_space_id, request_id, status_code, error_message, metadata }
 */
export const logSystemEvent = async (level, service, action, options = {}) => {
    try {
        const payload = {
            level: level.toUpperCase(),
            service: service.toUpperCase(),
            action,
            user_id: options.user_id || null,
            family_space_id: options.family_space_id || null,
            request_id: options.request_id || null,
            status_code: options.status_code || null,
            error_message: options.error_message || null,
            metadata: options.metadata || {}
        };

        // Fire and forget — silently ignore RLS or missing table errors
        supabase.from('system_logs').insert(payload).then(({ error }) => {
            if (error && error.code !== '42P01' && error.code !== '42501') {
                // 42P01 = table not found, 42501 = RLS policy violation — both are non-critical
                console.error('[Logger Error] Failed to insert system log:', error.message);
            }
        }).catch(() => {});
    } catch (err) {
        console.error('[Logger Error] Exception in logSystemEvent:', err.message);
    }
};
