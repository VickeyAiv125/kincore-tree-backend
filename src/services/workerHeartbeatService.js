import { supabase } from '../config/supabaseClient.js';
import os from 'os';
import crypto from 'crypto';

let currentWorkerId = null;
let heartbeatInterval = null;
let registerPromise = null;

const WORKER_GROUP = process.env.WORKER_GROUP || 'Main Worker';
const VERSION = process.env.APP_VERSION || process.env.npm_package_version || '1.0.0';

const normalizeEnvironment = (raw) => {
    const v = String(raw || '').toLowerCase().trim();
    if (['production', 'prod'].includes(v)) return 'production';
    if (['staging', 'stage', 'stg'].includes(v)) return 'staging';
    if (['testing', 'test', 'qa', 'development', 'dev', 'local'].includes(v)) return 'testing';
    return 'testing';
};

const resolveEnvironment = () => {
    if (process.env.RENDER === 'true') return 'production';
    return normalizeEnvironment(process.env.APP_ENV || process.env.DEPLOY_ENV || process.env.NODE_ENV);
};

const resolveNodeName = () => {
    const isRender = process.env.RENDER === 'true';
    const hostname = os.hostname().toLowerCase();
    if (isRender) {
        const service = process.env.RENDER_SERVICE_NAME || 'render';
        const instance = (process.env.RENDER_INSTANCE_ID || 'node').slice(0, 8);
        return `worker-${service}-${instance}`;
    }
    return `worker-local-${hostname}`;
};

export const getCurrentWorkerId = () => currentWorkerId;

export const getWorkerEnvironment = () => resolveEnvironment();

/**
 * Single canonical worker registration for this Node process.
 * Stable node_name avoids duplicate rows from dual heartbeat/jobsEngine registrars.
 */
export const ensureWorkerRegistered = async () => {
    if (currentWorkerId) return currentWorkerId;
    if (registerPromise) return registerPromise;

    registerPromise = (async () => {
        const nodeName = resolveNodeName();
        const environment = resolveEnvironment();
        const isRender = process.env.RENDER === 'true';
        const displayHostname = isRender && process.env.RENDER_SERVICE_NAME
            ? `${process.env.RENDER_SERVICE_NAME}.onrender.com`
            : os.hostname();

        const { data: existing } = await supabase
            .from('system_workers')
            .select('id')
            .eq('node_name', nodeName)
            .maybeSingle();

        if (existing?.id) {
            currentWorkerId = existing.id;
            await supabase
                .from('system_workers')
                .update({
                    status: 'active',
                    environment,
                    version: VERSION,
                    worker_group: isRender ? 'render-cluster' : WORKER_GROUP,
                    hostname: displayHostname,
                    last_heartbeat: new Date().toISOString()
                })
                .eq('id', currentWorkerId);
        } else {
            const newId = crypto.randomUUID();
            const { data, error } = await supabase
                .from('system_workers')
                .insert({
                    id: newId,
                    node_name: nodeName,
                    worker_group: isRender ? 'render-cluster' : WORKER_GROUP,
                    status: 'active',
                    environment,
                    version: VERSION,
                    hostname: displayHostname,
                    last_heartbeat: new Date().toISOString()
                })
                .select('id')
                .single();

            if (error) {
                // Race: another insert won — fetch by node_name
                const { data: raced } = await supabase
                    .from('system_workers')
                    .select('id')
                    .eq('node_name', nodeName)
                    .maybeSingle();
                if (!raced?.id) throw error;
                currentWorkerId = raced.id;
            } else {
                currentWorkerId = data.id;
            }
        }

        // Remove legacy duplicate local workers (random-suffix rows from old dual registration)
        await supabase
            .from('system_workers')
            .delete()
            .neq('id', currentWorkerId)
            .ilike('node_name', 'worker-local-node-%');

        console.log(`[WorkerHeartbeat] Registered ${nodeName} (${environment}) id=${currentWorkerId}`);
        return currentWorkerId;
    })();

    try {
        return await registerPromise;
    } finally {
        registerPromise = null;
    }
};

export const initWorkerHeartbeat = async () => {
    try {
        await ensureWorkerRegistered();

        if (heartbeatInterval) clearInterval(heartbeatInterval);
        heartbeatInterval = setInterval(async () => {
            if (!currentWorkerId) return;
            const { error: hbError } = await supabase
                .from('system_workers')
                .update({
                    last_heartbeat: new Date().toISOString(),
                    status: 'active',
                    environment: resolveEnvironment(),
                    updated_at: new Date().toISOString()
                })
                .eq('id', currentWorkerId);
            if (hbError) {
                console.error(`[WorkerHeartbeat] Failed heartbeat for ${currentWorkerId}:`, hbError);
            }
        }, 30000);

        process.off?.('SIGTERM', gracefulShutdown);
        process.off?.('SIGINT', gracefulShutdown);
        process.on('SIGTERM', gracefulShutdown);
        process.on('SIGINT', gracefulShutdown);
    } catch (err) {
        console.error('[WorkerHeartbeat] Initialization error:', err);
    }
};

const gracefulShutdown = async () => {
    if (currentWorkerId) {
        console.log(`[WorkerHeartbeat] Shutting down worker ${currentWorkerId}...`);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
        await supabase
            .from('system_workers')
            .update({
                status: 'offline',
                updated_at: new Date().toISOString()
            })
            .eq('id', currentWorkerId);
    }
    process.exit(0);
};
