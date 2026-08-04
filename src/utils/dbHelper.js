import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../config/supabaseClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const jsonDbPath = path.resolve(__dirname, '../data/council_fallback_db.json');

const tableCheckCache = {};

/**
 * Check if a table exists in Supabase.
 * Caches the check results to avoid redundant network overhead.
 */
export const tableExists = async (tableName) => {
    if (tableCheckCache[tableName] !== undefined) {
        return tableCheckCache[tableName];
    }
    try {
        const { error } = await supabase.from(tableName).select('*').limit(1);
        if (error && (error.code === 'PGRST202' || error.message.includes('relation') || error.message.includes('does not exist') || error.message.includes('schema cache'))) {
            tableCheckCache[tableName] = false;
            return false;
        }
        tableCheckCache[tableName] = true;
        return true;
    } catch (err) {
        tableCheckCache[tableName] = false;
        return false;
    }
};

/**
 * Read the current state of the local fallback database.
 */
export const readJsonDb = () => {
    try {
        const data = fs.readFileSync(jsonDbPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading JSON fallback DB:', err.message);
        return {};
    }
};

/**
 * Write a new state back to the local fallback database.
 */
export const writeJsonDb = (data) => {
    try {
        fs.writeFileSync(jsonDbPath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing JSON fallback DB:', err.message);
        return false;
    }
};
