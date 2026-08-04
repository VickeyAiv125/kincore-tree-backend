-- Migration: Create DevOps Jobs and Workers Tables

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

-- Pre-seed some default background jobs matching the client specifications
INSERT INTO background_jobs (id, name, description, job_type, schedule, schedule_cron, status, is_enabled)
VALUES 
    ('job-backup', 'Daily Database Backup', 'Creates a full snapshot of the primary PostgreSQL database', 'database', 'Daily at 12:00 AM', '0 0 * * *', 'idle', true),
    ('job-thumbnail', 'Media Thumbnail Compression', 'Generates compressed thumbnails for all uploaded family media', 'media', 'Manual / On Demand', null, 'idle', true),
    ('job-tree-sync', 'Family Tree Data Sync', 'Synchronizes family tree data across all family spaces', 'sync', 'Daily at 01:00 AM', '0 1 * * *', 'idle', true),
    ('job-pdf', 'PDF Descendant Report Generation', 'Processes pending PDF generation requests for descendant reports', 'reports', 'Daily at 02:00 AM', '0 2 * * *', 'idle', true),
    ('job-storage', 'Storage Usage Recalculation', 'Recalculates and updates storage_used_bytes for all family spaces', 'storage', 'Daily at 03:00 AM', '0 3 * * *', 'idle', true),
    ('job-subscription', 'Subscription Status Sync', 'Validates and updates subscription statuses across all families', 'billing', 'Daily at 04:00 AM', '0 4 * * *', 'idle', true),
    ('job-abuse', 'Abuse Report Aggregation', 'Aggregates and categorizes pending abuse reports for review', 'safety', 'Daily at 05:00 AM', '0 5 * * *', 'idle', true),
    ('job-email-digest', 'Email Digest Generation', 'Generates and dispatches daily email summaries to admins', 'notifications', 'Daily at 06:00 AM', '0 6 * * *', 'idle', true),
    ('job-notification', 'Notification Dispatch', 'Processes the notification queue and sends pending in-app notifications', 'notifications', 'Every 15 minutes', '*/15 * * * *', 'idle', true),
    ('job-audit', 'Audit Log Archival', 'Archives audit logs older than 90 days to cold storage', 'compliance', 'Monthly (1st)', '0 0 1 * *', 'idle', true)
ON CONFLICT (id) DO NOTHING;
