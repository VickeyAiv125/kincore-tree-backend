import { DEMO } from '../lib/ids.js';
import { upsert } from '../lib/upsert.js';
import { log } from '../lib/supabase.js';

const JOB_SEEDS = [
    { id: 'JOB-BACKUP', name: 'Daily DB Backup', description: 'Creates a full snapshot of the primary PostgreSQL database', job_type: 'database', schedule: 'Daily at 12:00 AM', schedule_cron: '0 0 * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-THUMBNAIL', name: 'Media Thumbnail Compression', description: 'Generates compressed thumbnails for all uploaded family media', job_type: 'media', schedule: 'Manual / On Demand', schedule_cron: null, status: 'idle', is_enabled: true },
    { id: 'JOB-STORAGE', name: 'Storage Usage Recalculation', description: 'Recalculates and updates storage_used_bytes for all family spaces', job_type: 'storage', schedule: 'Daily at 03:00 AM', schedule_cron: '0 3 * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-SUBSCRIPTION', name: 'Subscription Status Sync', description: 'Validates and updates subscription statuses across all families', job_type: 'billing', schedule: 'Daily at 04:00 AM', schedule_cron: '0 4 * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-ABUSE', name: 'Abuse Report Aggregation', description: 'Aggregates and categorizes pending abuse reports for review', job_type: 'safety', schedule: 'Daily at 05:00 AM', schedule_cron: '0 5 * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-PDF', name: 'PDF Report Cleanup', description: 'Processes pending PDF generation requests for descendant reports', job_type: 'reports', schedule: 'Daily at 02:00 AM', schedule_cron: '0 2 * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-AUDIT', name: 'Audit Log Archival', description: 'Archives audit logs older than 90 days to cold storage', job_type: 'compliance', schedule: 'Monthly (1st)', schedule_cron: '0 0 1 * *', status: 'idle', is_enabled: true },
    { id: 'JOB-KCC-RECONCILIATION', name: 'KCC Coin Reconciliation', description: 'Reconcile KCC Coin ledger or external BigK API status', job_type: 'wallet', schedule: 'Daily at 01:00 AM', schedule_cron: '0 1 * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-WEBHOOK-RETRY', name: 'Webhook Retry', description: 'Retry failed payment, coin, mall, or notification webhooks', job_type: 'webhook', schedule: 'Every 5 minutes', schedule_cron: '*/5 * * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-DEADLETTER-RECOVERY', name: 'Deadletter Recovery', description: 'Review and reprocess permanently failed jobs', job_type: 'system', schedule: 'Manual / On Demand', schedule_cron: null, status: 'idle', is_enabled: true },
    { id: 'JOB-STORY-EXPIRY', name: 'Story Expiry', description: 'Expire stories after 24/48/72 hours', job_type: 'content', schedule: 'Hourly', schedule_cron: '0 * * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-NOTIFICATION', name: 'Notification Delivery', description: 'Send in-app, email, and push notifications', job_type: 'notifications', schedule: 'Every 15 minutes', schedule_cron: '*/15 * * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-MALL-SYNC', name: 'Mall Sync', description: 'Sync Mall orders, listings, fulfillment, or settlement status', job_type: 'mall', schedule: 'Hourly', schedule_cron: '0 * * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-XP-ACHIEVEMENT', name: 'XP/Achievement Calc', description: 'Calculate XP and level updates from verified actions', job_type: 'gamification', schedule: 'Daily at 06:00 AM', schedule_cron: '0 6 * * *', status: 'idle', is_enabled: true },
    { id: 'JOB-PUBLIC-SEARCH-INDEX', name: 'Public Search Index', description: 'Update opt-in public people search index', job_type: 'search', schedule: 'Daily at 07:00 AM', schedule_cron: '0 7 * * *', status: 'idle', is_enabled: true }
];

/**
 * DevOps jobs/workers/incidents/logs + Support tickets + announcements.
 */
export async function seedOps(byEmail) {
    log('--- devops / support / announcements ---');
    const devops = byEmail['devops@admin.com'];
    const owner = byEmail['owner@admin.com'];
    const member1 = byEmail['member1@demo.kincore'];
    const business = byEmail['business@admin.com'];

    await upsert('background_jobs', JOB_SEEDS, { onConflict: 'id' });

    await upsert('system_workers', {
        id: DEMO.worker1,
        node_name: 'demo-worker-1',
        worker_group: 'general',
        status: 'online',
        current_job_id: null,
        last_heartbeat: new Date().toISOString(),
        environment: 'demo',
        version: '3.0.0-demo',
        hostname: 'demo-host'
    }, { onConflict: 'id' });

    await upsert('system_incidents', {
        id: DEMO.incident1,
        title: 'Demo API latency spike',
        description: 'Synthetic incident for DevOps Active Comms / Incident Management demos.',
        severity: 'medium',
        status: 'investigating',
        reported_by: devops.id,
        affected_services: ['api', 'auth'],
        sla_deadline: new Date(Date.now() + 4 * 3600000).toISOString()
    }, { onConflict: 'id' });

    await upsert('system_logs', {
        id: DEMO.log1,
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'demo-seed',
        action: 'SEED_COMPLETE',
        user_id: devops.id,
        family_space_id: DEMO.spaceId,
        request_id: 'demo-seed-run',
        status_code: 200,
        error_message: null,
        metadata: { tag: DEMO.tag }
    }, { onConflict: 'id' });

    await upsert('support_tickets', {
        id: DEMO.ticket1,
        user_id: member1.id,
        subject: 'Cannot RSVP to reunion (Demo)',
        description: 'Demo support ticket for Support / Business ticketing UIs.',
        priority: 'medium',
        status: 'open',
        category: 'events',
        family_space_id: DEMO.spaceId,
        assigned_to: business.id
    }, { onConflict: 'id' });

    await upsert('ticket_messages', {
        id: DEMO.ticketMsg1,
        ticket_id: DEMO.ticket1,
        sender_id: member1.id,
        message: 'I tap RSVP and nothing happens (demo).',
        is_internal: false
    }, { onConflict: 'id' });

    await upsert('announcements', {
        id: DEMO.announcement1,
        title: 'Welcome to the Kincore Demo Environment',
        content: 'Use the demo accounts listed in scripts/demo-seed/README.md to explore Owner, Family, Branch, Council, Business, DevOps, and Auditor panels.',
        category: 'product',
        is_public: true,
        author_id: owner.id
    }, { onConflict: 'id' });
}
