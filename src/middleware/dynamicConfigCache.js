import { supabase } from '../config/supabaseClient.js';

let cache = {
    max_connections: 5000,
    api_timeout: 30000,
    maintenance_mode: '0',
    global_rate_limit: 1000
};

const CACHE_KEYS = ['max_connections', 'api_timeout', 'maintenance_mode', 'global_rate_limit'];
const OVERLAY_KEY = 'devops_runtime_by_env';

const normalizeEnvironment = (raw) => {
    const v = String(raw || '').toLowerCase().trim();
    if (['production', 'prod'].includes(v)) return 'production';
    if (['staging', 'stage', 'stg'].includes(v)) return 'staging';
    if (['testing', 'test', 'qa', 'development', 'dev', 'local'].includes(v)) return 'testing';
    return 'testing';
};

const runtimeEnvironment = () =>
    normalizeEnvironment(process.env.APP_ENV || process.env.DEPLOY_ENV || process.env.NODE_ENV || 'development');

const unwrap = (raw) => {
    if (raw == null) return raw;
    if (typeof raw !== 'string') return raw;
    let val = raw;
    if (val.startsWith('"') && val.endsWith('"')) {
        try { return JSON.parse(val); } catch (_) { return val.slice(1, -1); }
    }
    try {
        return JSON.parse(val);
    } catch (_) {
        return val;
    }
};

export const getDynamicConfig = () => cache;

export const refreshConfigCache = async () => {
    try {
        const { data, error } = await supabase
            .from('system_configs')
            .select('key, value')
            .in('key', [...CACHE_KEYS, OVERLAY_KEY]);

        if (error) {
            console.error('Failed to refresh config cache:', error);
            return;
        }

        if (!data || data.length === 0) return;

        const byKey = {};
        data.forEach((config) => {
            byKey[config.key] = unwrap(config.value);
        });

        // Global flat values first
        for (const key of CACHE_KEYS) {
            if (byKey[key] !== undefined && byKey[key] !== null) {
                cache[key] = byKey[key];
            }
        }

        // Overlay for this node's runtime environment wins
        const runtime = runtimeEnvironment();
        const overlays = byKey[OVERLAY_KEY];
        if (overlays && typeof overlays === 'object' && overlays[runtime]) {
            for (const key of CACHE_KEYS) {
                if (overlays[runtime][key] !== undefined && overlays[runtime][key] !== null) {
                    cache[key] = overlays[runtime][key];
                }
            }
        }

        console.log('[LoadBalancer] Dynamic config cache refreshed successfully:', cache);
    } catch (err) {
        console.error('[LoadBalancer] Error refreshing config cache:', err);
    }
};

// Initiate first load
refreshConfigCache();
