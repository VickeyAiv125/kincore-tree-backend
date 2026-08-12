import { DEMO } from '../lib/ids.js';
import { upsert } from '../lib/upsert.js';
import { log } from '../lib/supabase.js';

/**
 * Family space, branches, tree, persons, relations, memberships, staff.
 */
export async function seedFamily(byEmail) {
    log('--- family graph ---');
    const owner = byEmail['owner@admin.com'];
    const branch = byEmail['branch@admin.com'];
    const council = byEmail['council@admin.com'];
    const coadmin = byEmail['coadmin@demo.kincore'];
    const member1 = byEmail['member1@demo.kincore'];
    const member2 = byEmail['member2@demo.kincore'];
    const seller = byEmail['seller@demo.kincore'];

    await upsert('family_spaces', [
        {
            id: DEMO.spaceId,
            owner_id: owner.id,
            name: 'Chen Family Clan (Demo)',
            description: 'Demo family space for Kincore product walkthroughs across all admin and app modules.',
            code: 'CHEN-DEMO',
            status: 'active',
            visibility: 'Listed on marketplace',
            region: 'Asia',
            category: 'clan',
            contact_email: 'owner@admin.com',
            max_members: 500,
            subscription_tier: 'premium',
            storage_quota_bytes: 53687091200,
            storage_used_bytes: 1288490188,
            settings: {
                demo: true,
                tag: DEMO.tag,
                governance_locked: false,
                externalSearchIndexing: true,
                globalProfileVisibility: true
            },
            updated_at: new Date().toISOString()
        },
        {
            id: DEMO.spaceRiskId,
            owner_id: businessOr(owner, byEmail).id,
            name: 'Risk Review Space (Demo)',
            description: 'Secondary space flagged for Business Admin risk review demos.',
            code: 'RISK-DEMO',
            status: 'active',
            risk_level: 'high',
            risk_score: 82,
            status_reason: 'Multiple unresolved abuse reports (demo)',
            visibility: 'private',
            settings: { demo: true, tag: DEMO.tag },
            updated_at: new Date().toISOString()
        }
    ], { onConflict: 'id' });

    await upsert('clan_trees', {
        id: DEMO.treeId,
        family_space_id: DEMO.spaceId,
        name: 'Chen Main Tree'
    }, { onConflict: 'id' });

    await upsert('family_branches', [
        {
            id: DEMO.branchNorthId,
            family_space_id: DEMO.spaceId,
            name: 'North Branch',
            description: 'Primary demo branch (branch@admin.com)',
            branch_admin_id: branch.id,
            region: 'North',
            founding_year: 1952,
            visibility: 'family',
            can_add_members: true,
            can_edit_history: true,
            can_upload_media: true
        },
        {
            id: DEMO.branchSouthId,
            family_space_id: DEMO.spaceId,
            name: 'South Branch',
            description: 'Secondary demo branch',
            branch_admin_id: member2.id,
            region: 'South',
            founding_year: 1978,
            visibility: 'family',
            can_add_members: true,
            can_edit_history: false,
            can_upload_media: true
        }
    ], { onConflict: 'id' });

    const P = DEMO.persons;
    await upsert('persons', [
        { id: P.grandpa, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Wei Chen', first_name: 'Wei', last_name: 'Chen', gender: 'male', birth_date: '1935-03-12', is_alive: false, death_date: '2018-08-01', branch_id: DEMO.branchNorthId, status: 'active', privacy_mode: 'family', role: 'member', bio: 'Family patriarch (demo).' },
        { id: P.grandma, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Mei Lin Chen', first_name: 'Mei Lin', last_name: 'Chen', gender: 'female', birth_date: '1938-11-04', is_alive: true, branch_id: DEMO.branchNorthId, status: 'active', privacy_mode: 'family', role: 'member' },
        { id: P.father, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'David Chen', first_name: 'David', last_name: 'Chen', gender: 'male', birth_date: '1965-06-20', is_alive: true, claimed_by: owner.id, email: 'owner@admin.com', branch_id: DEMO.branchNorthId, status: 'active', member_status: 'active_user', role: 'owner' },
        { id: P.mother, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Priya Chen', first_name: 'Priya', last_name: 'Chen', gender: 'female', birth_date: '1968-02-14', is_alive: true, claimed_by: coadmin.id, email: 'coadmin@demo.kincore', branch_id: DEMO.branchNorthId, status: 'active', member_status: 'active_user', role: 'family-admin' },
        { id: P.uncle, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'James Chen', first_name: 'James', last_name: 'Chen', gender: 'male', birth_date: '1962-09-01', is_alive: true, branch_id: DEMO.branchSouthId, status: 'active', role: 'member' },
        { id: P.aunt, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Sara Chen', first_name: 'Sara', last_name: 'Chen', gender: 'female', birth_date: '1964-01-22', is_alive: true, branch_id: DEMO.branchSouthId, status: 'active', role: 'member' },
        { id: P.child1, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Aisha Chen', first_name: 'Aisha', last_name: 'Chen', gender: 'female', birth_date: '1995-07-08', is_alive: true, claimed_by: member1.id, email: 'member1@demo.kincore', branch_id: DEMO.branchNorthId, status: 'active', member_status: 'active_user', role: 'member' },
        { id: P.child2, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Ravi Chen', first_name: 'Ravi', last_name: 'Chen', gender: 'male', birth_date: '1998-12-19', is_alive: true, claimed_by: member2.id, email: 'member2@demo.kincore', branch_id: DEMO.branchSouthId, status: 'active', member_status: 'active_user', role: 'member' },
        { id: P.cousin, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Maya Seller', first_name: 'Maya', last_name: 'Seller', gender: 'female', birth_date: '1994-04-02', is_alive: true, claimed_by: seller.id, email: 'seller@demo.kincore', branch_id: DEMO.branchNorthId, status: 'active', member_status: 'active_user', role: 'member' },
        { id: P.pending, clan_tree_id: DEMO.treeId, family_space_id: DEMO.spaceId, full_name: 'Pending Invitee', first_name: 'Pending', last_name: 'Invitee', gender: 'male', birth_date: '2000-01-01', is_alive: true, email: 'invitee@demo.kincore', branch_id: DEMO.branchNorthId, status: 'active', member_status: 'invitation_pending', pending_role: 'member', role: 'member' }
    ], { onConflict: 'id' });

    // person_relations (legacy) + person_relationships (newer)
    await upsert('person_relations', [
        { id: 'a2100000-0000-4000-8000-000000000001', clan_tree_id: DEMO.treeId, person_id_1: P.grandpa, person_id_2: P.grandma, relation_type: 'spouse' },
        { id: 'a2100000-0000-4000-8000-000000000002', clan_tree_id: DEMO.treeId, person_id_1: P.grandpa, person_id_2: P.father, relation_type: 'parent' },
        { id: 'a2100000-0000-4000-8000-000000000003', clan_tree_id: DEMO.treeId, person_id_1: P.grandma, person_id_2: P.father, relation_type: 'parent' },
        { id: 'a2100000-0000-4000-8000-000000000004', clan_tree_id: DEMO.treeId, person_id_1: P.grandpa, person_id_2: P.uncle, relation_type: 'parent' },
        { id: 'a2100000-0000-4000-8000-000000000005', clan_tree_id: DEMO.treeId, person_id_1: P.father, person_id_2: P.mother, relation_type: 'spouse' },
        { id: 'a2100000-0000-4000-8000-000000000006', clan_tree_id: DEMO.treeId, person_id_1: P.father, person_id_2: P.child1, relation_type: 'parent' },
        { id: 'a2100000-0000-4000-8000-000000000007', clan_tree_id: DEMO.treeId, person_id_1: P.mother, person_id_2: P.child1, relation_type: 'parent' },
        { id: 'a2100000-0000-4000-8000-000000000008', clan_tree_id: DEMO.treeId, person_id_1: P.father, person_id_2: P.child2, relation_type: 'parent' },
        { id: 'a2100000-0000-4000-8000-000000000009', clan_tree_id: DEMO.treeId, person_id_1: P.uncle, person_id_2: P.cousin, relation_type: 'parent' }
    ], { onConflict: 'id' });

    await upsert('person_relationships', [
        { id: 'a2200000-0000-4000-8000-000000000001', family_space_id: DEMO.spaceId, person_id: P.grandpa, related_person_id: P.grandma, relationship_type: 'spouse' },
        { id: 'a2200000-0000-4000-8000-000000000002', family_space_id: DEMO.spaceId, person_id: P.father, related_person_id: P.child1, relationship_type: 'parent' },
        { id: 'a2200000-0000-4000-8000-000000000003', family_space_id: DEMO.spaceId, person_id: P.mother, related_person_id: P.child1, relationship_type: 'parent' },
        { id: 'a2200000-0000-4000-8000-000000000004', family_space_id: DEMO.spaceId, person_id: P.father, related_person_id: P.child2, relationship_type: 'parent' }
    ], { onConflict: 'id' });

    const membershipRows = [
        { id: 'a2400000-0000-4000-8000-000000000001', email: 'owner@admin.com', role: 'owner', branch_id: null },
        { id: 'a2400000-0000-4000-8000-000000000002', email: 'family@admin.com', role: 'owner', branch_id: null },
        { id: 'a2400000-0000-4000-8000-000000000003', email: 'council@admin.com', role: 'editor', branch_id: null },
        { id: 'a2400000-0000-4000-8000-000000000004', email: 'branch@admin.com', role: 'branch-admin', branch_id: DEMO.branchNorthId },
        { id: 'a2400000-0000-4000-8000-000000000005', email: 'coadmin@demo.kincore', role: 'family-admin', branch_id: null },
        { id: 'a2400000-0000-4000-8000-000000000006', email: 'member1@demo.kincore', role: 'member', branch_id: DEMO.branchNorthId },
        { id: 'a2400000-0000-4000-8000-000000000007', email: 'member2@demo.kincore', role: 'member', branch_id: DEMO.branchSouthId },
        { id: 'a2400000-0000-4000-8000-000000000008', email: 'seller@demo.kincore', role: 'member', branch_id: DEMO.branchNorthId }
    ].map((m) => ({
        id: m.id,
        family_space_id: DEMO.spaceId,
        user_id: byEmail[m.email].id,
        role: m.role,
        status: 'active',
        branch_id: m.branch_id,
        joined_at: new Date().toISOString()
    }));

    await upsert('family_memberships', membershipRows, { onConflict: 'id' });

    // Also attach family@admin.com as owner membership
    // (already included above)

    await upsert('family_space_staff', [
        { id: 'a2300000-0000-4000-8000-000000000001', family_space_id: DEMO.spaceId, user_id: owner.id, role: 'admin', is_active: true, assigned_by: owner.id },
        { id: 'a2300000-0000-4000-8000-000000000002', family_space_id: DEMO.spaceId, user_id: coadmin.id, role: 'admin', is_active: true, assigned_by: owner.id },
        { id: 'a2300000-0000-4000-8000-000000000003', family_space_id: DEMO.spaceId, user_id: branch.id, role: 'manager', is_active: true, assigned_by: owner.id },
        { id: 'a2300000-0000-4000-8000-000000000004', family_space_id: DEMO.spaceId, user_id: council.id, role: 'editor', is_active: true, assigned_by: owner.id }
    ], { onConflict: 'id' });

    await upsert('family_history', {
        id: DEMO.history1,
        family_space_id: DEMO.spaceId,
        title: 'Migration to Singapore (Demo)',
        content: 'The Chen family relocated in the 1960s. Used for Migration Map / History demos.',
        cover_image: 'https://placehold.co/800x400/png?text=Migration',
        sort_order: 1,
        created_at: new Date().toISOString()
    }, { onConflict: 'id' });

    await upsert('migration_points', {
        id: DEMO.migration1,
        family_space_id: DEMO.spaceId,
        title: 'Chen Migration — Fujian to Singapore',
        from_location: 'Fujian, China',
        to_location: 'Singapore',
        from_lat: 26.0789,
        from_lng: 119.2965,
        to_lat: 1.3521,
        to_lng: 103.8198,
        reason: 'Trade and education',
        is_branch_migration: true,
        date_type: 'year',
        date_value: null,
        approximate_period: '1962',
        description: 'Demo migration point for map UI.',
        visibility: 'family',
        tags: ['demo', DEMO.tag],
        persons: [P.grandpa, P.grandma],
        branches: [DEMO.branchNorthId]
    }, { onConflict: 'id' });

    return { spaceId: DEMO.spaceId, treeId: DEMO.treeId };
}

function businessOr(fallback, byEmail) {
    return byEmail['business@admin.com'] || fallback;
}
