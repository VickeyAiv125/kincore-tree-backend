import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Seed data for background_jobs (15 jobs as requested by client)
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

async function run() {
    console.log('🔧 Creating background_jobs table...');
    
    // Check if it already exists
    const { data: existing, error: checkError } = await sb.from('background_jobs').select('id').limit(1);
    if (!checkError) {
        console.log('✅ background_jobs already exists, seeding jobs...');
        // Seed with upsert
        const { error: seedError } = await sb.from('background_jobs').upsert(JOB_SEEDS, { onConflict: 'id' });
        if (seedError) console.error('Seed error:', seedError);
        else console.log('✅ Seeded', JOB_SEEDS.length, 'jobs');
    } else {
        console.log('❌ background_jobs does not exist yet. Please create it from Supabase SQL editor with this SQL:');
        console.log(`
CREATE TABLE IF NOT EXISTS background_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    job_type TEXT NOT NULL,
    schedule TEXT NOT NULL,
    schedule_cron TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    last_run TIMESTAMPTZ,
    next_run TIMESTAMPTZ,
    last_run_duration TEXT,
    failure_reason TEXT,
    retry_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_workers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    node_name TEXT NOT NULL,
    worker_group TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'offline',
    current_job_id TEXT,
    last_heartbeat TIMESTAMPTZ,
    environment TEXT DEFAULT 'production',
    version TEXT,
    hostname TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
        `);
    }

    // Check system_workers
    const { data: existingWorkers, error: workerCheckError } = await sb.from('system_workers').select('id').limit(1);
    if (!workerCheckError) {
        console.log('✅ system_workers already exists');
    } else {
        console.log('❌ system_workers does not exist. See SQL above.');
    }
}

run().catch(console.error);
