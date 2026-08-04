import { sb, log, warn } from './supabase.js';

/**
 * Upsert helper — ignores missing-table / missing-column errors so seed stays resilient.
 */
export async function upsert(table, rows, { onConflict, ignoreDuplicates = false } = {}) {
    const list = Array.isArray(rows) ? rows : [rows];
    if (!list.length) return { data: null, error: null };

    const { data, error } = await sb.from(table).upsert(list, {
        onConflict,
        ignoreDuplicates
    }).select();

    if (error) {
        // Retry without unknown columns one-by-one is expensive; log and continue.
        if (/Could not find the table|schema cache|column .* does not exist/i.test(error.message)) {
            warn(`skip ${table}: ${error.message}`);
            return { data: null, error, skipped: true };
        }
        warn(`upsert ${table} failed:`, error.message);
        return { data: null, error };
    }
    log(`✓ ${table} (${list.length})`);
    return { data, error: null };
}

export async function insertIfMissing(table, rows, matchKeys = ['id']) {
    const list = Array.isArray(rows) ? rows : [rows];
    const inserted = [];
    for (const row of list) {
        let q = sb.from(table).select(matchKeys.join(','));
        for (const k of matchKeys) {
            if (row[k] != null) q = q.eq(k, row[k]);
        }
        const { data: existing } = await q.maybeSingle();
        if (existing) continue;
        const { data, error } = await sb.from(table).insert(row).select().maybeSingle();
        if (error) {
            warn(`insert ${table} failed:`, error.message);
        } else if (data) {
            inserted.push(data);
        }
    }
    if (inserted.length) log(`✓ ${table} inserted ${inserted.length}`);
    return inserted;
}
