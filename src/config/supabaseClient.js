import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL and Service Role Key are required in .env');
}

// Diagnostic check for key type (do not log the full key for security).
// Legacy JWT keys encode "service_role" in the payload, so checking the raw
// string produces a false negative.
const getJwtRole = (key) => {
    try {
        const payload = key.split('.')[1];
        if (!payload) return null;
        return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role || null;
    } catch {
        return null;
    }
};
const isServiceKey = supabaseKey.startsWith('sb_secret_') || getJwtRole(supabaseKey) === 'service_role';
console.log('>>> [DB DEBUG] Supabase Key is Service Role:', isServiceKey);

if (!isServiceKey) {
    console.warn('>>> [DB WARNING] The provided SUPABASE_SERVICE_ROLE_KEY does not appear to be a service role key. Row Level Security (RLS) might be enforced, which can cause 403 errors or policy violations in backend operations.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
    }
});
