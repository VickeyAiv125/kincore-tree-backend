import { supabase } from '../config/supabaseClient.js';
import { logActivity } from '../utils/logger.js';
import { sendEmail, isEmailConfigured } from './emailService.js';
import { normalizeFamilyRole } from '../utils/familyRolePolicy.js';

/** Family Admin Settings → Notification Channels defaults */
export const DEFAULT_NOTIFICATION_CHANNELS = {
    email: true,
    push: true,
    events: true,
    governance: true,
    registry: true,
    claims: true,
    abuse: true,
    roles: true,
    subscription: true
};

export const mergeNotificationChannels = (stored = {}) => ({
    ...DEFAULT_NOTIFICATION_CHANNELS,
    ...(stored && typeof stored === 'object' ? stored : {})
});

/**
 * Map a policy action (or explicit override) to a Settings channel key.
 */
export const resolveNotificationChannelKey = (action, options = {}) => {
    if (options.channel) return options.channel;
    const a = String(action || '').toLowerCase();
    if (a.includes('event')) return 'events';
    if (a.includes('subscription') || a.includes('purchase') || a.includes('billing')) return 'subscription';
    if (a.includes('claim')) return 'claims';
    if (a.includes('abuse') || a.includes('moderation') || a.includes('report')) return 'abuse';
    if (a.includes('role')) return 'roles';
    if (a.includes('governance') || a.includes('group') || a.includes('membership')) return 'governance';
    if (
        a.includes('registration') ||
        a.includes('profile') ||
        a.includes('registry') ||
        a.includes('content') ||
        a.includes('member added')
    ) {
        return 'registry';
    }
    // Support tickets etc. — no category gate beyond email/push masters
    return null;
};

/** Canonical notification policy catalog for Family Admin Policies page */
export const POLICY_CATALOG = [
    {
        category: 'User Management',
        action: 'New user registration',
        description: 'Notify when a member joins or is invited',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'new_user_registration',
        frequency: 'instant',
        priority: 'normal',
        isDummy: false
    },
    {
        category: 'User Management',
        action: 'User profile update',
        description: 'Notify on sensitive profile / lineage changes',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: false,
        defaultPush: true,
        template: 'user_profile_update',
        frequency: 'instant',
        priority: 'normal',
        isDummy: false
    },
    {
        category: 'Group Management',
        action: 'New group created',
        description: 'Notify when a branch / group is created',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'new_group_created',
        frequency: 'instant',
        priority: 'normal',
        isDummy: false
    },
    {
        category: 'Group Management',
        action: 'Group membership change',
        description: 'Notify on joins, approvals, or membership changes',
        defaultRecipients: ['owner', 'family-admin', 'branch-admin'],
        defaultEmail: false,
        defaultPush: true,
        template: 'group_membership_change',
        frequency: 'instant',
        priority: 'normal',
        isDummy: false
    },
    {
        category: 'Content Management',
        action: 'New content posted',
        description: 'Notify when posts / media are published',
        defaultRecipients: ['owner', 'family-admin', 'editor'],
        defaultEmail: false,
        defaultPush: true,
        template: 'new_content_posted',
        frequency: 'instant',
        priority: 'low',
        isDummy: false
    },
    {
        category: 'Content Management',
        action: 'Content updated',
        description: 'Notify when moderated content is updated',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: false,
        defaultPush: false,
        template: 'content_updated',
        frequency: 'instant',
        priority: 'low',
        isDummy: false
    },
    {
        category: 'Monetization',
        action: 'New purchase',
        description: 'Notify on marketplace / mall purchases',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: false,
        template: 'new_purchase',
        frequency: 'instant',
        priority: 'normal',
        isDummy: false
    },
    {
        category: 'Monetization',
        action: 'Subscription renewal',
        description: 'Notify on plan renewals and billing events',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'subscription_renewal',
        frequency: 'instant',
        priority: 'high',
        isDummy: false
    },
    {
        category: 'Support',
        action: 'New support ticket',
        description: 'Notify when a family admin opens a support ticket',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'new_support_ticket',
        frequency: 'instant',
        priority: 'high',
        isDummy: false
    },
    {
        category: 'Support',
        action: 'Support ticket updated',
        description: 'Notify when a support ticket is updated or replied',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'support_ticket_updated',
        frequency: 'instant',
        priority: 'normal',
        isDummy: false
    },
    {
        category: 'Events',
        action: 'Event reminder',
        description: 'Notify when a family event is created or a reminder is due',
        defaultRecipients: ['owner', 'family-admin', 'member'],
        defaultEmail: true,
        defaultPush: true,
        template: 'event_reminder',
        frequency: 'instant',
        priority: 'normal',
        isDummy: false
    },
    {
        category: 'Governance',
        action: 'Claim request',
        description: 'Notify when lineage claims are submitted or resolved',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'claim_request',
        frequency: 'instant',
        priority: 'high',
        isDummy: false
    },
    {
        category: 'Governance',
        action: 'Abuse report',
        description: 'Notify when content is reported for moderation',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'abuse_report',
        frequency: 'instant',
        priority: 'high',
        isDummy: false
    },
    {
        category: 'Governance',
        action: 'Role change',
        description: 'Notify when family roles are assigned or changed',
        defaultRecipients: ['owner', 'family-admin'],
        defaultEmail: true,
        defaultPush: true,
        template: 'role_change',
        frequency: 'instant',
        priority: 'high',
        isDummy: false
    }
];

const ROLE_QUERY_ALIASES = {
    owner: ['owner'],
    'family-admin': ['family-admin', 'admin', 'family admin', 'family_admin'],
    'co-admin': ['co-admin', 'coadmin'],
    'branch-admin': ['branch-admin', 'branch admin', 'manager'],
    editor: ['editor', 'council', 'council-admin'],
    member: ['member']
};

const MAX_LOGS = 100;

export const buildDefaultPolicies = () => {
    const policies = {};
    for (const item of POLICY_CATALOG) {
        policies[item.action] = {
            email: item.defaultEmail,
            push: item.defaultPush,
            enabled: true,
            recipients: [...item.defaultRecipients],
            template: item.template,
            frequency: item.frequency,
            priority: item.priority,
            isDummy: false
        };
    }
    return policies;
};

export const mergePoliciesWithDefaults = (stored = {}) => {
    const defaults = buildDefaultPolicies();
    const merged = { ...defaults };
    for (const [action, value] of Object.entries(stored || {})) {
        merged[action] = {
            ...defaults[action],
            ...value,
            isDummy: false
        };
    }
    return merged;
};

const expandRolesForQuery = (roles = []) => {
    const out = new Set();
    for (const role of roles) {
        const n = normalizeFamilyRole(role);
        (ROLE_QUERY_ALIASES[n] || [n, role]).forEach((r) => out.add(r));
    }
    return [...out];
};

const appendDeliveryLog = async (familySpaceId, entry) => {
    try {
        const { data: space } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', familySpaceId)
            .single();

        const settings = space?.settings || {};
        const logs = Array.isArray(settings.notification_delivery_logs)
            ? settings.notification_delivery_logs
            : [];

        logs.unshift({
            id: `ndl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            created_at: new Date().toISOString(),
            ...entry
        });

        await supabase
            .from('family_spaces')
            .update({
                settings: {
                    ...settings,
                    notification_delivery_logs: logs.slice(0, MAX_LOGS)
                }
            })
            .eq('id', familySpaceId);
    } catch (err) {
        console.warn('[NotificationService] failed to append delivery log:', err.message);
    }
};

const resolveRecipients = async (familySpaceId, roles) => {
    const roleList = expandRolesForQuery(roles);
    const { data: members, error } = await supabase
        .from('family_memberships')
        .select('user_id, role')
        .eq('family_space_id', familySpaceId)
        .in('role', roleList);

    if (error) throw error;

    const userIds = [...new Set((members || []).map((m) => m.user_id).filter(Boolean))];
    if (!userIds.length) return [];

    const { data: users } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds);

    const userMap = new Map((users || []).map((u) => [u.id, u]));
    const byUser = new Map();
    for (const m of members || []) {
        if (!m.user_id || byUser.has(m.user_id)) continue;
        const u = userMap.get(m.user_id);
        byUser.set(m.user_id, {
            user_id: m.user_id,
            role: normalizeFamilyRole(m.role),
            email: u?.email || null,
            name: `${u?.first_name || ''} ${u?.last_name || ''}`.trim() || u?.email || 'Member'
        });
    }
    return [...byUser.values()];
};

const renderTemplate = (templateKey, { title, message, action, familyName }) => {
    const subject = title || action;
    const bodyText = message || title || action;
    const html = `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111">
        <h2 style="margin:0 0 12px">${subject}</h2>
        <p>${bodyText}</p>
        <hr style="border:none;border-top:1px solid #eee;margin:16px 0" />
        <p style="font-size:12px;color:#666">
          Kincore notification${familyName ? ` · ${familyName}` : ''}<br/>
          Template: ${templateKey || 'default'} · Action: ${action}
        </p>
      </div>
    `;
    return { subject, text: bodyText, html };
};

/**
 * Dispatch a notification based on family space policies.
 */
export const dispatchNotification = async (
    familySpaceId,
    action,
    title,
    message,
    targetRoles,
    options = {}
) => {
    try {
        if (!familySpaceId) return { skipped: true, reason: 'missing_family' };

        const { data: spaceData, error: spaceError } = await supabase
            .from('family_spaces')
            .select('name, settings')
            .eq('id', familySpaceId)
            .single();

        if (spaceError) throw spaceError;

        const policies = mergePoliciesWithDefaults(spaceData.settings?.notification_policies);
        const policy = policies[action];
        const channelPrefs = mergeNotificationChannels(spaceData.settings?.notifications);

        if (!policy || policy.enabled === false || (!policy.email && !policy.push)) {
            await appendDeliveryLog(familySpaceId, {
                action,
                status: 'skipped',
                reason: 'policy_disabled',
                title
            });
            return { skipped: true, reason: 'policy_disabled' };
        }

        // Master delivery channels from Settings → Notification Channels
        const allowEmail = channelPrefs.email !== false && !!policy.email;
        const allowPush = channelPrefs.push !== false && !!policy.push;
        if (!allowEmail && !allowPush) {
            await appendDeliveryLog(familySpaceId, {
                action,
                status: 'skipped',
                reason: 'master_channels_disabled',
                title
            });
            return { skipped: true, reason: 'master_channels_disabled' };
        }

        // Category gates (events / governance / registry / claims / abuse / roles / subscription)
        const channelKey = resolveNotificationChannelKey(action, options);
        if (channelKey && channelPrefs[channelKey] === false) {
            await appendDeliveryLog(familySpaceId, {
                action,
                status: 'skipped',
                reason: `channel_${channelKey}_disabled`,
                title,
                channel: channelKey
            });
            return { skipped: true, reason: `channel_${channelKey}_disabled` };
        }

        const roles = (Array.isArray(policy.recipients) && policy.recipients.length
            ? policy.recipients
            : (targetRoles || POLICY_CATALOG.find((p) => p.action === action)?.defaultRecipients || ['owner', 'family-admin']));

        let recipients = await resolveRecipients(familySpaceId, roles);

        // Explicit extra recipients (e.g. ticket creator)
        if (Array.isArray(options.extraUserIds) && options.extraUserIds.length) {
            const { data: extras } = await supabase
                .from('users')
                .select('id, email, first_name, last_name')
                .in('id', options.extraUserIds);
            for (const u of extras || []) {
                if (!recipients.find((r) => r.user_id === u.id)) {
                    recipients.push({
                        user_id: u.id,
                        role: 'member',
                        email: u.email,
                        name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email
                    });
                }
            }
        }

        if (!recipients.length) {
            await appendDeliveryLog(familySpaceId, {
                action,
                status: 'skipped',
                reason: 'no_recipients',
                title,
                roles
            });
            return { skipped: true, reason: 'no_recipients' };
        }

        const frequency = policy.frequency || 'instant';
        // Digest frequencies are stored for a future digest worker; skip immediate send unless this is a manual test.
        if (!options.test && frequency !== 'instant') {
            await appendDeliveryLog(familySpaceId, {
                action,
                status: 'queued',
                reason: `digest_${frequency}`,
                title,
                recipients: recipients.length,
                roles,
                frequency,
                priority: policy.priority || 'normal'
            });
            return { ok: true, queued: true, frequency, recipients: recipients.length };
        }

        const templateKey = policy.template || 'default';
        const rendered = renderTemplate(templateKey, {
            title,
            message,
            action,
            familyName: spaceData.name
        });

        const delivery = {
            push: { attempted: false, sent: 0, failed: 0 },
            email: { attempted: false, sent: 0, failed: 0, mocked: !isEmailConfigured() },
            channel: channelKey,
            masters: { email: allowEmail, push: allowPush }
        };

        // In-app / push channel → notifications table
        if (allowPush) {
            delivery.push.attempted = true;
            const rows = recipients.map((r) => ({
                user_id: r.user_id,
                type: action.replace(/\s+/g, '_').toLowerCase(),
                title: rendered.subject,
                message: rendered.text,
                created_at: new Date().toISOString()
            }));
            const { error: insertError } = await supabase.from('notifications').insert(rows);
            if (insertError) {
                delivery.push.failed = recipients.length;
                console.error('[NotificationService] push/in-app insert failed:', insertError.message);
            } else {
                delivery.push.sent = recipients.length;
            }
        }

        // Email channel
        if (allowEmail) {
            delivery.email.attempted = true;
            for (const r of recipients) {
                if (!r.email) {
                    delivery.email.failed += 1;
                    continue;
                }
                const result = await sendEmail({
                    to: r.email,
                    subject: `[Kincore] ${rendered.subject}`,
                    html: rendered.html,
                    text: rendered.text
                });
                if (result.ok) delivery.email.sent += 1;
                else delivery.email.failed += 1;
                if (result.mocked) delivery.email.mocked = true;
            }
        }

        await appendDeliveryLog(familySpaceId, {
            action,
            status: 'delivered',
            title: rendered.subject,
            recipients: recipients.length,
            roles,
            template: templateKey,
            frequency,
            priority: policy.priority || 'normal',
            delivery,
            test: Boolean(options.test)
        });

        await logActivity('SYSTEM', 'DISPATCH_NOTIFICATION', 'family_spaces', familySpaceId, null, {
            action,
            recipients_count: recipients.length,
            methods: { email: allowEmail, push: allowPush },
            channel: channelKey,
            delivery
        });

        return {
            ok: true,
            action,
            recipients: recipients.length,
            delivery
        };
    } catch (err) {
        console.error('>>> DISPATCH NOTIFICATION ERROR:', err);
        if (familySpaceId) {
            await appendDeliveryLog(familySpaceId, {
                action,
                status: 'error',
                title,
                error: err.message
            });
        }
        return { ok: false, error: err.message };
    }
};

export const getNotificationDeliveryLogs = async (familySpaceId, limit = 50) => {
    const { data: space, error } = await supabase
        .from('family_spaces')
        .select('settings')
        .eq('id', familySpaceId)
        .single();
    if (error) throw error;
    const logs = space?.settings?.notification_delivery_logs || [];
    return logs.slice(0, limit);
};

export const testNotificationPolicy = async (familySpaceId, action, actorUserId) => {
    return dispatchNotification(
        familySpaceId,
        action,
        `Test: ${action}`,
        `This is a test notification for "${action}" triggered from Family Admin Policies.`,
        undefined,
        { test: true, extraUserIds: actorUserId ? [actorUserId] : [] }
    );
};
