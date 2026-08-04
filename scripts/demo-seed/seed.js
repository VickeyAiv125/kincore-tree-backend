#!/usr/bin/env node
/**
 * Kincore full-module demo seeder (upsert-only).
 *
 * Usage:
 *   npm run seed:demo
 *   node scripts/demo-seed/seed.js
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in backend/.env
 */
import { DEMO, DEMO_USERS } from './lib/ids.js';
import { log, warn } from './lib/supabase.js';
import { seedUsers } from './modules/01-users.js';
import { seedFamily } from './modules/02-family.js';
import { seedContent } from './modules/03-content.js';
import { seedCommerce } from './modules/04-commerce.js';
import { seedGovernance } from './modules/05-governance.js';
import { seedOps } from './modules/06-ops.js';

async function main() {
    const started = Date.now();
    log('Starting upsert demo seed…');
    log(`Password for all demo accounts: ${DEMO.password}`);

    const byEmail = await seedUsers();
    await seedFamily(byEmail);
    await seedContent(byEmail);
    await seedCommerce(byEmail);
    await seedGovernance(byEmail);
    await seedOps(byEmail);

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    log(`Done in ${secs}s`);
    log('');
    log('=== Demo logins (password: ' + DEMO.password + ') ===');
    for (const u of DEMO_USERS) {
        const role = u.platform_role || u.family_role || 'member';
        log(`  ${u.email.padEnd(28)} → ${role}`);
    }
    log('');
    log(`Primary family space: Chen Family Clan (Demo)  id=${DEMO.spaceId}  code=CHEN-DEMO`);
    log(`North branch id (branch@admin.com): ${DEMO.branchNorthId}`);
}

main().catch((err) => {
    warn('FATAL', err?.message || err);
    process.exit(1);
});
