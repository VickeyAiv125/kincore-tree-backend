import { DEMO_USERS } from '../lib/ids.js';
import { ensureAuthUser, ensureAdminRole } from '../lib/ensureAuthUser.js';
import { log } from '../lib/supabase.js';

/**
 * Seed platform + demo member auth accounts (upsert).
 * @returns {Record<string, {id:string,email:string}>}
 */
export async function seedUsers() {
    log('--- users / admins ---');
    const byEmail = {};
    for (const u of DEMO_USERS) {
        const account = await ensureAuthUser(u);
        byEmail[account.email] = account;
        if (u.platform_role) {
            await ensureAdminRole(account.id, u.platform_role);
        }
    }
    return byEmail;
}
