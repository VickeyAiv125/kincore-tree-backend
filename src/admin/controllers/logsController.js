import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const getSystemLogs = async (req, res) => {
    try {
        const { search, service, level, limit = 50 } = req.query;

        let query = supabase.from('system_logs').select('*').order('timestamp', { ascending: false });

        if (level && level !== 'ALL') {
            query = query.eq('level', level);
        }

        if (service && service !== 'ALL SERVICES') {
            // Need to map frontend service names to backend ENUM strings if necessary, 
            // but for now assume exact match or close enough match
            query = query.eq('service', service.toUpperCase().replace(/\s+/g, '_').replace(/\//g, ''));
        }

        if (search) {
            // Simple ilike across a few fields. Supabase doesn't natively do OR across multiple columns easily without an explicit OR string.
            // Using PostgREST or filter
            query = query.or(`action.ilike.%${search}%,error_message.ilike.%${search}%,request_id.ilike.%${search}%,user_id.eq.${search}`);
        }

        query = query.limit(parseInt(limit, 10));

        const { data, error } = await query;

        if (error) {
            // If the table doesn't exist, just return empty array for now
            if (error.code === '42P01') {
                return res.json([]);
            }
            throw error;
        }

        res.json(data);
    } catch (err) {
        console.error('Error fetching logs:', err);
        res.status(500).json({ error: err.message });
    }
};

export const exportSystemLogs = async (req, res) => {
    try {
        const { search, service, level, format = 'json' } = req.body;

        let query = supabase.from('system_logs').select('*').order('timestamp', { ascending: false });

        if (level && level !== 'ALL') {
            query = query.eq('level', level);
        }
        if (service && service !== 'ALL SERVICES') {
            query = query.eq('service', service.toUpperCase().replace(/\s+/g, '_').replace(/\//g, ''));
        }
        if (search) {
            query = query.or(`action.ilike.%${search}%,error_message.ilike.%${search}%,request_id.ilike.%${search}%,user_id.eq.${search}`);
        }

        // Export max 1000 logs for safety
        const { data, error } = await query.limit(1000);

        if (error) throw error;

        // Mask sensitive data in metadata
        const scrubbedData = data.map(log => {
            if (log.metadata) {
                // simple scrubber
                const scrubbedMeta = { ...log.metadata };
                ['password', 'token', 'otp', 'secret'].forEach(key => {
                    if (scrubbedMeta[key]) scrubbedMeta[key] = '***MASKED***';
                });
                return { ...log, metadata: scrubbedMeta };
            }
            return log;
        });

        if (format === 'csv') {
            // Very simple CSV converter
            if (scrubbedData.length === 0) return res.send('');
            const headers = Object.keys(scrubbedData[0]).join(',');
            const rows = scrubbedData.map(log => {
                return Object.values(log).map(val => {
                    if (typeof val === 'object') return `"${JSON.stringify(val).replace(/"/g, '""')}"`;
                    return `"${String(val).replace(/"/g, '""')}"`;
                }).join(',');
            });
            res.header('Content-Type', 'text/csv');
            res.attachment(`system_logs_export_${Date.now()}.csv`);
            return res.send([headers, ...rows].join('\n'));
        }

        // JSON format
        res.header('Content-Type', 'application/json');
        res.attachment(`system_logs_export_${Date.now()}.json`);
        res.json(scrubbedData);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
