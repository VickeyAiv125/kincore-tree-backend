import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import os from 'os';
import cronParser from 'cron-parser';
import { ensureWorkerRegistered, getCurrentWorkerId } from '../../services/workerHeartbeatService.js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

class JobsEngine {
    constructor() {
        this.workerId = null;
        this.heartbeatInterval = null;
        this.pollingInterval = null;
        this.isPolling = false;
        
        // Dynamic Scaling Configs
        this.maxConcurrentJobs = 1;
        this.pollIntervalSeconds = 60;
        this.currentPollInterval = 60;
        this.loadAlertThreshold = 75;
        this.activeJobsCount = 0;
        
        // Share the single host worker with workerHeartbeatService (no second registration)
        this.registerWorker();
    }

    async registerWorker() {
        try {
            this.workerId = await ensureWorkerRegistered();
        } catch (err) {
            console.error('[jobsEngine] Failed to attach to host worker:', err.message);
            this.workerId = getCurrentWorkerId() || crypto.randomUUID();
        }

        await this.loadConfigs();
        
        // Start polling for scheduled jobs (heartbeat owned by workerHeartbeatService)
        this.pollingInterval = setInterval(() => this.pollScheduledJobs(), this.pollIntervalSeconds * 1000);
    }

    async loadConfigs() {
        try {
            const { data } = await sb.from('system_configs').select('*').in('key', ['max_concurrent_jobs', 'poll_interval_seconds', 'load_alert_threshold']);
            if (data && data.length > 0) {
                const configs = data.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
                
                const newConcurrent = parseInt(configs.max_concurrent_jobs || '1', 10);
                const newPoll = parseInt(configs.poll_interval_seconds || '60', 10);
                
                this.maxConcurrentJobs = isNaN(newConcurrent) ? 1 : newConcurrent;
                this.pollIntervalSeconds = isNaN(newPoll) ? 60 : newPoll;
                this.loadAlertThreshold = parseInt(configs.load_alert_threshold || '75', 10);
                
                // Update polling interval dynamically if changed
                if (this.currentPollInterval !== this.pollIntervalSeconds) {
                    console.log(`[jobsEngine] Dynamic Scaling: Polling interval updated to ${this.pollIntervalSeconds}s`);
                    if (this.pollingInterval) clearInterval(this.pollingInterval);
                    this.pollingInterval = setInterval(() => this.pollScheduledJobs(), this.pollIntervalSeconds * 1000);
                    this.currentPollInterval = this.pollIntervalSeconds;
                }
            }
        } catch (e) {
            console.error('[jobsEngine] Error loading configs', e);
        }
    }

    async heartbeat() {
        // Ownership moved to workerHeartbeatService — keep offline cleanup only
        const twoMinsAgo = new Date(Date.now() - 120000).toISOString();
        await sb.from('system_workers')
            .update({ status: 'offline' })
            .lt('last_heartbeat', twoMinsAgo);
            
        const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
        await sb.from('system_workers')
            .delete()
            .lt('last_heartbeat', oneHourAgo);
    }

    async getEngineMetrics() {
        const { data: workers } = await sb.from('system_workers').select('*');
        const activeWorkers = workers?.filter(w => w.status === 'active') || [];
        
        const { data: jobs } = await sb.from('background_jobs').select('status, last_run_duration, retry_count');
        
        const running = jobs?.filter(j => j.status === 'running').length || 0;
        const failed = jobs?.filter(j => j.retry_count > 0 || j.status === 'failed').length || 0;
        
        let poolStatus = 'Active';
        if (activeWorkers.length === 0) poolStatus = 'Offline';
        else if (failed > 3) poolStatus = 'Degraded';
        else if (running > 10) poolStatus = 'Overloaded';
        
        // Calculate average duration roughly
        let totalMs = 0;
        let count = 0;
        jobs?.forEach(j => {
            if (j.last_run_duration && j.last_run_duration.includes('ms')) {
                totalMs += parseInt(j.last_run_duration);
                count++;
            }
        });
        const avgDuration = count > 0 ? `${Math.round(totalMs / count)}ms` : '0ms';

        return {
            poolStatus,
            activeWorkers: activeWorkers.length,
            totalWorkers: workers?.length || 0,
            queueBacklog: running,
            failedRate: failed,
            averageRuntime: avgDuration
        };
    }

    async getJobs() {
        const { data } = await sb.from('background_jobs').select('*').order('id', { ascending: true });
        return data || [];
    }

    async triggerJob(jobId, executeCallback) {
        console.log(`[jobsEngine] Starting triggerJob for ${jobId}`);
        // Enqueue and mark running
        const { error: runErr } = await sb.from('background_jobs').update({
            status: 'running',
            last_run: new Date().toISOString()
        }).eq('id', jobId);
        
        if (runErr) console.error(`[jobsEngine] Error setting running for ${jobId}:`, runErr);

        const startTime = Date.now();
        try {
            console.log(`[jobsEngine] Executing callback for ${jobId}`);
            // Execute the actual logic
            await executeCallback();
            console.log(`[jobsEngine] Callback executed for ${jobId}`);
            
            const durationMs = Date.now() - startTime;
            // Mark success
            await sb.from('background_jobs').update({
                status: 'success',
                last_run_duration: `${durationMs}ms`,
                failure_reason: null
            }).eq('id', jobId);
            
            // Increment success count using RPC (or just simple update for MVP)
            const { data } = await sb.from('background_jobs').select('success_count').eq('id', jobId).single();
            await sb.from('background_jobs').update({ success_count: (data?.success_count || 0) + 1 }).eq('id', jobId);
            
            return { success: true, duration: durationMs };
        } catch (error) {
            const durationMs = Date.now() - startTime;
            
            // Mark failure
            const { data } = await sb.from('background_jobs').select('retry_count').eq('id', jobId).single();
            await sb.from('background_jobs').update({
                status: 'failed',
                last_run_duration: `${durationMs}ms`,
                failure_reason: error.message,
                retry_count: (data?.retry_count || 0) + 1
            }).eq('id', jobId);
            
            return { success: false, error: error.message };
        }
    }
    
    async pauseJob(jobId) {
        await sb.from('background_jobs').update({ status: 'paused', is_enabled: false }).eq('id', jobId);
    }
    
    async resumeJob(jobId) {
        await sb.from('background_jobs').update({ status: 'idle', is_enabled: true }).eq('id', jobId);
    }
    
    async cancelJob(jobId) {
        await sb.from('background_jobs').update({ status: 'cancelled' }).eq('id', jobId).eq('status', 'running');
    }
    
    async updateSchedule(jobId, updates) {
        await sb.from('background_jobs').update(updates).eq('id', jobId);
    }

    async pollScheduledJobs() {
        if (this.isPolling) return; // Prevent overlapping loops
        
        try {
            this.isPolling = true;
            if (!this.workerId) {
                this.workerId = await ensureWorkerRegistered();
            }
            await this.loadConfigs();

            // 1. Check for any cron-scheduled jobs that are due, and queue them
            const now = new Date().toISOString();
            const { data: dueJobs } = await sb.from('background_jobs')
                .select('id, schedule_cron, schedule')
                .lte('next_run', now)
                .neq('status', 'running')
                .eq('is_enabled', true);

            if (dueJobs && dueJobs.length > 0) {
                for (const dj of dueJobs) {
                    const cronExpr = dj.schedule || dj.schedule_cron;
                    if (cronExpr) {
                        try {
                            const interval = cronParser.CronExpressionParser.parse(cronExpr);
                            const next_run = interval.next().toDate().toISOString();
                            await sb.from('background_jobs')
                                .update({ status: 'queued', next_run })
                                .eq('id', dj.id);
                            console.log(`[jobsEngine] Clock queued scheduled job: ${dj.id}, next run: ${next_run}`);
                        } catch (e) {
                            console.error(`Invalid cron for ${dj.id}:`, e);
                        }
                    }
                }
            }

            // 2. Continuously claim jobs until we hit our dynamic Max Concurrent limit
            while (this.activeJobsCount < this.maxConcurrentJobs) {
                const { data: job, error } = await sb.rpc('claim_next_job', { p_worker_id: this.workerId });
                
                if (error || !job) {
                    break; // No more jobs available in queue
                }

                console.log(`[jobsEngine] Processing job concurrently (${this.activeJobsCount + 1}/${this.maxConcurrentJobs}): ${job.id}`);
                this.activeJobsCount++;
                
                // Execute job asynchronously to allow more claims
                this.executeScheduledJob(job).catch(e => console.error(e));
            }

        } catch (err) {
            console.error('[jobsEngine] Fatal polling error:', err);
        } finally {
            this.isPolling = false;
        }
    }

    async executeScheduledJob(job) {
        const startTime = Date.now();
        try {
            switch (job.id) {
                case 'JOB-STORAGE': {
                    // Query SUM(size) from media grouped by family_space_id
                    const { data: mediaSizes, error: mediaError } = await sb.from('media').select('family_space_id, size');
                    if (mediaError && mediaError.code !== 'PGRST116') {
                        // Ignore if table doesn't exist yet in mock env, otherwise throw
                        console.error('[jobsEngine] Media table error:', mediaError);
                    } else if (mediaSizes) {
                        const spaceSizes = {};
                        mediaSizes.forEach(m => {
                            if (!spaceSizes[m.family_space_id]) spaceSizes[m.family_space_id] = 0;
                            spaceSizes[m.family_space_id] += (m.size || 0);
                        });
                        // Update family_spaces
                        for (const [fsId, totalSize] of Object.entries(spaceSizes)) {
                            await sb.from('family_spaces').update({ 
                                storage_used_bytes: totalSize
                            }).eq('id', fsId);
                        }
                    }
                    break;
                }
                
                case 'JOB-NOTIFICATION': {
                    // Dispatch simulated SendGrid email, update status to sent
                    const { data: notifications, error: notifError } = await sb.from('notifications').select('id').eq('status', 'pending');
                    if (notifError && notifError.code !== 'PGRST116') {
                        console.error('[jobsEngine] Notifications error:', notifError);
                    } else if (notifications && notifications.length > 0) {
                        const ids = notifications.map(n => n.id);
                        await sb.from('notifications').update({ status: 'sent', updated_at: new Date().toISOString() }).in('id', ids);
                    }
                    break;
                }

                case 'JOB-AUDIT': {
                    // Fetch logs > 30 days, upload JSON to Storage, then DELETE from DB
                    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                    const { data: oldLogs, error: logError } = await sb.from('audit_logs').select('*').lt('created_at', thirtyDaysAgo);
                    if (logError) throw new Error(logError.message);
                    
                    if (oldLogs && oldLogs.length > 0) {
                        const blob = Buffer.from(JSON.stringify(oldLogs));
                        const filename = `audit_archive_${Date.now()}.json`;
                        // Attempt upload (might fail if bucket doesn't exist yet, we catch it)
                        const { error: uploadError } = await sb.storage.from('kincore-archives').upload(filename, blob, { contentType: 'application/json' });
                        if (uploadError) console.warn('[jobsEngine] Archive bucket upload failed:', uploadError.message);
                        
                        // Delete from DB
                        const ids = oldLogs.map(l => l.id);
                        await sb.from('audit_logs').delete().in('id', ids);
                    }
                    break;
                }

                case 'JOB-BACKUP': {
                    // Query tables, generate JSON blob, upload to Supabase Storage
                    const { data: configs } = await sb.from('system_configs').select('*');
                    const backupBlob = Buffer.from(JSON.stringify({ configs }));
                    const backupFilename = `db_backup_${Date.now()}.json`;
                    const { error: backupUploadError } = await sb.storage.from('kincore-backups').upload(backupFilename, backupBlob, { contentType: 'application/json' });
                    if (backupUploadError) {
                        console.warn('[jobsEngine] Backup bucket upload failed:', backupUploadError.message);
                    }
                    break;
                }

                case 'JOB-PDF': {
                    // Use pdfkit to generate PDF, upload to Storage, delete local, query DB to hide minors
                    const fs = await import('fs');
                    const path = await import('path');
                    let PDFDocument;
                    try {
                        PDFDocument = (await import('pdfkit')).default;
                    } catch (e) {
                        throw new Error("pdfkit not installed. Please run 'npm install pdfkit'");
                    }
                    
                    // Query DB to hide minors
                    const { data: users, error: dbError } = await sb.from('users').select('*').gte('age', 18);
                    
                    const doc = new PDFDocument();
                    const tempPath = path.join(os.tmpdir(), `report_${Date.now()}.pdf`);
                    const stream = fs.createWriteStream(tempPath);
                    doc.pipe(stream);
                    doc.text('Kincore Platform Report (Minors Hidden)');
                    if (users && !dbError) {
                        users.forEach(u => doc.text(`User: ${u.name || u.id}`));
                    }
                    doc.end();
                    
                    await new Promise(resolve => stream.on('finish', resolve));
                    
                    const pdfBuffer = fs.readFileSync(tempPath);
                    const { error: uploadError } = await sb.storage.from('kincore-reports').upload(`report_${Date.now()}.pdf`, pdfBuffer, { contentType: 'application/pdf' });
                    
                    fs.unlinkSync(tempPath);
                    if (uploadError) console.warn('[jobsEngine] PDF bucket upload failed:', uploadError.message);
                    break;
                }

                case 'JOB-THUMBNAIL': {
                    // Fetch image_raw, process with sharp, re-upload, update DB to image_compressed
                    let sharp;
                    try {
                        sharp = (await import('sharp')).default;
                    } catch (e) {
                        throw new Error("sharp not installed. Please run 'npm install sharp'");
                    }

                    const { data: rawImages, error: rawError } = await sb.from('media').select('*').eq('type', 'image_raw').limit(10);
                    if (!rawError && rawImages && rawImages.length > 0) {
                        for (const img of rawImages) {
                            if (!img.file_path) continue;
                            const { data: fileData, error: downloadError } = await sb.storage.from('media').download(img.file_path);
                            if (!downloadError && fileData) {
                                const buffer = Buffer.from(await fileData.arrayBuffer());
                                const compressedBuffer = await sharp(buffer)
                                    .resize(300, 300, { fit: 'inside' })
                                    .webp({ quality: 80 })
                                    .toBuffer();
                                
                                const newPath = img.file_path.replace('_raw', '_compressed') + '.webp';
                                const { error: uploadError } = await sb.storage.from('media').upload(newPath, compressedBuffer, { contentType: 'image/webp' });
                                
                                if (!uploadError) {
                                    await sb.from('media').update({ type: 'image_compressed', file_path: newPath }).eq('id', img.id);
                                }
                            }
                        }
                    }
                    break;
                }

                case 'JOB-SUBSCRIPTION': {
                    // Subscription status sync and feature gating
                    const now = new Date().toISOString();
                    const { data: expiredSubs, error: subError } = await sb.from('subscriptions').select('id, user_id, family_space_id').lt('expires_at', now).eq('status', 'active');
                    if (!subError && expiredSubs && expiredSubs.length > 0) {
                        const subIds = expiredSubs.map(s => s.id);
                        const spaceIds = expiredSubs.map(s => s.family_space_id).filter(id => id);
                        
                        await sb.from('subscriptions').update({ status: 'expired' }).in('id', subIds);
                        // Downgrade family spaces to free tier if subscription expired
                        if (spaceIds.length > 0) {
                            await sb.from('family_spaces').update({ plan_tier: 'free', features_gated: true }).in('id', spaceIds);
                        }
                    }
                    break;
                }

                case 'JOB-ABUSE': {
                    // Abuse report aggregation and escalation
                    const { data: reports, error: reportError } = await sb.from('abuse_reports').select('reported_user_id').eq('status', 'pending');
                    if (!reportError && reports && reports.length > 0) {
                        const counts = {};
                        reports.forEach(r => {
                            if (r.reported_user_id) counts[r.reported_user_id] = (counts[r.reported_user_id] || 0) + 1;
                        });
                        
                        // Escalate if reported 3 or more times
                        for (const [userId, count] of Object.entries(counts)) {
                            if (count >= 3) {
                                await sb.from('users').update({ status: 'suspended', suspended_reason: 'Multiple abuse reports pending review' }).eq('id', userId);
                            }
                        }
                        
                        await sb.from('abuse_reports').update({ status: 'processed' }).eq('status', 'pending');
                    }
                    break;
                }

                case 'JOB-STORY-EXPIRY': {
                    // Expiring 24-hour stories
                    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
                    const { data: oldStories, error: storyError } = await sb.from('stories').select('id').lt('created_at', twentyFourHoursAgo).eq('status', 'active');
                    if (!storyError && oldStories && oldStories.length > 0) {
                        const ids = oldStories.map(s => s.id);
                        await sb.from('stories').update({ status: 'expired' }).in('id', ids);
                    }
                    break;
                }

                case 'JOB-WEBHOOK-RETRY':
                case 'JOB-DEADLETTER-RECOVERY':
                default:
                    // MOCK EXECUTION DELAY for unconfigured jobs
                    await new Promise(res => setTimeout(res, 2000));
                    break;
            }
            
            const durationMs = Date.now() - startTime;
            
            // Mark Success
            await sb.from('background_jobs').update({
                status: 'success',
                last_run_duration: `${durationMs}ms`,
                success_count: (job.success_count || 0) + 1
            }).eq('id', job.id);
            
        } catch (err) {
            const durationMs = Date.now() - startTime;
            
            // Mark Failure
            await sb.from('background_jobs').update({
                status: 'failed',
                last_run_duration: `${durationMs}ms`,
                failure_reason: err.message,
                retry_count: (job.retry_count || 0) + 1
            }).eq('id', job.id);
        } finally {
            this.activeJobsCount--;
            // Clear worker's current job state if completely idle
            if (this.activeJobsCount === 0) {
                await sb.from('system_workers').update({ current_job_id: null }).eq('id', this.workerId);
            }
        }
    }
}

export default new JobsEngine();
