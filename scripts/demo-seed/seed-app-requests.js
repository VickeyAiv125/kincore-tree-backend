#!/usr/bin/env node
/**
 * Seed dummy rows for GET /api/app/requests
 * (branch_edit_requests + claims for a family space)
 *
 * Usage:
 *   node scripts/demo-seed/seed-app-requests.js
 *   node scripts/demo-seed/seed-app-requests.js --space=29c39af1-31da-4579-8cdd-5ed5a55be9d3
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
});

const DEFAULT_SPACE = '29c39af1-31da-4579-8cdd-5ed5a55be9d3';
const spaceArg = process.argv.find((a) => a.startsWith('--space='));
const SPACE_ID = spaceArg ? spaceArg.split('=')[1] : DEFAULT_SPACE;

const IDS = {
    branch: 'b1000000-0000-4000-8000-000000000001',
    personSibling: 'b2000000-0000-4000-8000-000000000001',
    personClaim: 'b2000000-0000-4000-8000-000000000002',
    ber1: 'b3000000-0000-4000-8000-000000000001',
    ber2: 'b3000000-0000-4000-8000-000000000002',
    ber3: 'b3000000-0000-4000-8000-000000000003',
    ber4: 'b3000000-0000-4000-8000-000000000004',
    claim1: 'b4000000-0000-4000-8000-000000000001',
    claim2: 'b4000000-0000-4000-8000-000000000002',
    claim3: 'b4000000-0000-4000-8000-000000000003'
};

const log = (...a) => console.log('[seed-app-requests]', ...a);
const warn = (...a) => console.warn('[seed-app-requests]', ...a);

async function main() {
    const { data: space, error: spaceErr } = await sb
        .from('family_spaces')
        .select('id,name,status')
        .eq('id', SPACE_ID)
        .maybeSingle();
    if (spaceErr || !space) {
        throw new Error(`Family space not found: ${SPACE_ID}`);
    }
    log(`Space: ${space.name} (${space.id})`);

    const { data: members } = await sb
        .from('family_memberships')
        .select('user_id, role')
        .eq('family_space_id', SPACE_ID);

    if (!members?.length) {
        throw new Error('No members in this family space — login user must be a member to see requests.');
    }

    // Prefer owner, else first member — requests are filtered by logged-in user id
    const ownerMem = members.find((m) => m.role === 'owner') || members[0];
    const requesterId = ownerMem.user_id;
    const reviewerId = members.find((m) => m.user_id !== requesterId)?.user_id || requesterId;

    const { data: requester } = await sb.from('users').select('id,email,first_name').eq('id', requesterId).maybeSingle();
    log(`Requester (login as this user to see data): ${requester?.email || requesterId}`);

    // Branch (optional but improves target_member label)
    await sb.from('family_branches').upsert({
        id: IDS.branch,
        family_space_id: SPACE_ID,
        name: 'Main Branch (Demo Requests)',
        description: 'Seeded for /api/app/requests demos',
        visibility: 'family',
        can_add_members: true
    }, { onConflict: 'id' });
    log('✓ family_branches');

    // Extra persons for claims / context
    await sb.from('persons').upsert([
        {
            id: IDS.personSibling,
            family_space_id: SPACE_ID,
            full_name: 'Alex Demo Sibling',
            first_name: 'Alex',
            last_name: 'Demo',
            gender: 'male',
            is_alive: true,
            status: 'active',
            member_status: 'active_user'
        },
        {
            id: IDS.personClaim,
            family_space_id: SPACE_ID,
            full_name: 'Jordan Unclaimed',
            first_name: 'Jordan',
            last_name: 'Unclaimed',
            gender: 'female',
            is_alive: true,
            status: 'active',
            member_status: 'invitation_pending'
        }
    ], { onConflict: 'id' });
    log('✓ persons');

    const now = Date.now();
    const daysAgo = (d) => new Date(now - d * 86400000).toISOString();

    const { error: berErr } = await sb.from('branch_edit_requests').upsert([
        {
            id: IDS.ber1,
            family_space_id: SPACE_ID,
            branch_id: IDS.branch,
            requested_by: requesterId,
            request_type: 'update_info',
            current_value: { birth_date: '1990-01-01', first_name: 'Test', last_name: 'User' },
            proposed_value: { birth_date: '1990-01-15', first_name: 'Test', last_name: 'User' },
            reason: 'Corrected birth date (demo pending request)',
            status: 'pending',
            reviewer_id: null,
            created_at: daysAgo(1),
            updated_at: daysAgo(1)
        },
        {
            id: IDS.ber2,
            family_space_id: SPACE_ID,
            branch_id: IDS.branch,
            requested_by: requesterId,
            request_type: 'update_info',
            current_value: { first_name: 'Test', last_name: 'User', name: 'Test User' },
            proposed_value: { first_name: 'Testy', last_name: 'User', name: 'Testy User' },
            reason: 'Preferred display name (demo approved)',
            status: 'approved',
            reviewer_id: reviewerId,
            reviewer_comment: 'Looks good — approved (demo).',
            created_at: daysAgo(5),
            updated_at: daysAgo(4)
        },
        {
            id: IDS.ber3,
            family_space_id: SPACE_ID,
            branch_id: IDS.branch,
            requested_by: requesterId,
            request_type: 'join_family',
            current_value: null,
            proposed_value: { branch_id: IDS.branch, note: 'Want to join Main Branch' },
            reason: 'Request to join branch (demo rejected)',
            status: 'rejected',
            reviewer_id: reviewerId,
            reviewer_comment: 'Incomplete details (demo).',
            created_at: daysAgo(10),
            updated_at: daysAgo(9)
        },
        {
            id: IDS.ber4,
            family_space_id: SPACE_ID,
            branch_id: IDS.branch,
            requested_by: requesterId,
            request_type: 'add_member',
            current_value: null,
            proposed_value: { first_name: 'Sam', last_name: 'Demo', relation: 'cousin' },
            reason: 'Add cousin to tree (demo pending)',
            status: 'pending',
            reviewer_id: null,
            created_at: daysAgo(0),
            updated_at: daysAgo(0)
        }
    ], { onConflict: 'id' });
    if (berErr) throw berErr;
    log('✓ branch_edit_requests (4)');

    const { error: claimErr } = await sb.from('claims').upsert([
        {
            id: IDS.claim1,
            user_id: requesterId,
            person_id: IDS.personClaim,
            family_space_id: SPACE_ID,
            status: 'pending',
            type: 'identity',
            details: { reason: 'This is my cousin — demo identity claim' },
            requested_by_name: requester?.first_name || 'Demo User',
            confidence_score: 70,
            claimed_at: daysAgo(2),
            created_at: daysAgo(2)
        },
        {
            id: IDS.claim2,
            user_id: requesterId,
            person_id: IDS.personSibling,
            family_space_id: SPACE_ID,
            status: 'approved',
            type: 'identity',
            details: { reason: 'Verified sibling claim (demo)' },
            requested_by_name: requester?.first_name || 'Demo User',
            confidence_score: 90,
            claimed_at: daysAgo(8),
            created_at: daysAgo(8)
        },
        {
            id: IDS.claim3,
            user_id: requesterId,
            person_id: IDS.personSibling,
            family_space_id: SPACE_ID,
            status: 'pending',
            type: 'edit',
            details: { reason: 'Update occupation on claimed profile (demo)' },
            requested_by_name: requester?.first_name || 'Demo User',
            confidence_score: 60,
            claimed_at: daysAgo(0),
            created_at: daysAgo(0)
        }
    ], { onConflict: 'id' });
    if (claimErr) throw claimErr;
    log('✓ claims (3)');

    // Verify what the API would return for this user
    const { data: bers } = await sb.from('branch_edit_requests').select('id,status,request_type').eq('family_space_id', SPACE_ID).eq('requested_by', requesterId);
    const { data: claims } = await sb.from('claims').select('id,status,type').eq('family_space_id', SPACE_ID).eq('user_id', requesterId);
    log(`Done. For user ${requester?.email}: ${bers?.length || 0} branch requests + ${claims?.length || 0} claims`);
    log(`Test: GET /api/app/requests?family_space_id=${SPACE_ID}`);
    log('(Must be logged in as that user — API only returns YOUR requests.)');
}

main().catch((e) => {
    warn('FATAL', e.message || e);
    process.exit(1);
});
