-- MIGRATION: DevOps Job Queue Engine
-- Creates tables to support a robust backend job scheduling and queue engine using Supabase.

CREATE TABLE IF NOT EXISTS system_jobs_registry (
    job_id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    schedule_cron VARCHAR(50),
    is_enabled BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    retry_policy JSONB DEFAULT '{"max_retries": 3, "backoff": "exponential"}',
    worker_group VARCHAR(100) DEFAULT 'Main Worker',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_jobs_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id VARCHAR(100) REFERENCES system_jobs_registry(job_id) ON DELETE CASCADE,
    payload JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'pending', -- pending, running, success, failed, retrying, dead-letter
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert the known 15 jobs into the registry
INSERT INTO system_jobs_registry (job_id, name, description, worker_group) VALUES
('JOB-BACKUP', 'Daily DB Backup', 'Automated database backups and snapshots.', 'Backup Worker'),
('JOB-THUMBNAIL', 'Media Thumbnail Compression', 'Compress uploaded photos or videos.', 'Media Worker'),
('JOB-STORAGE', 'Storage Usage Recalculation', 'Recalculates storage usage by Family Space.', 'Storage Worker'),
('JOB-SUBSCRIPTION', 'Subscription Status Sync', 'Syncs billing and subscription status.', 'Billing Worker'),
('JOB-ABUSE', 'Abuse Report Aggregation', 'Aggregates abuse reports and safety signals.', 'Safety Worker'),
('JOB-PDF', 'PDF Report Generation', 'Manages descendant report generation queue.', 'PDF Worker'),
('JOB-AUDIT', 'Audit Log Archival', 'Archives old audit logs to cold storage.', 'Audit Worker'),
('JOB-KCC-RECONCILIATION', 'KCC Coin Reconciliation', 'Reconcile KCC Coin ledger status.', 'Wallet Worker'),
('JOB-WEBHOOK-RETRY', 'Webhook Retry Processor', 'Retry failed webhook deliveries.', 'Webhook Worker'),
('JOB-DEADLETTER-RECOVERY', 'Dead-letter Queue Recovery', 'Review permanently failed jobs.', 'Main Worker'),
('JOB-STORY-EXPIRY', 'Story Expiration Sweep', 'Expire stories after 24 hours.', 'Main Worker'),
('JOB-NOTIFICATION', 'Notification Dispatch', 'Send in-app, email, and push notifications.', 'Notification Worker'),
('JOB-MALL-SYNC', 'Mall Order Sync', 'Sync Mall orders and fulfillment status.', 'Mall Worker'),
('JOB-XP-ACHIEVEMENT', 'XP Achievement Calc', 'Calculate XP and level updates.', 'Main Worker'),
('JOB-PUBLIC-SEARCH-INDEX', 'Public Search Index Sync', 'Update opt-in public people search index.', 'Main Worker')
ON CONFLICT (job_id) DO NOTHING;
