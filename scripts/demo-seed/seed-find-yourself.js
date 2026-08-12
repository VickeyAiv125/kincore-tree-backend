/**
 * Seed unclaimed, searchable people for GET /api/families/find-yourself
 *
 *   node scripts/demo-seed/seed-find-yourself.js
 */
import { sb, log } from './lib/supabase.js';
import { upsert } from './lib/upsert.js';
import { DEMO } from './lib/ids.js';
import { ensureAuthUser } from './lib/ensureAuthUser.js';

const SPACE_ID = 'c1000000-0000-4000-8000-000000000001';
const TREE_ID = 'c1000000-0000-4000-8000-000000000002';

const PEOPLE = [
    {
        id: 'c2000000-0000-4000-8000-000000000001',
        first_name: 'Rahul',
        last_name: 'Sharma',
        gender: 'male',
        birth_date: '1992-05-14'
    },
    {
        id: 'c2000000-0000-4000-8000-000000000002',
        first_name: 'Priya',
        last_name: 'Sharma',
        gender: 'female',
        birth_date: '1994-11-02'
    },
    {
        id: 'c2000000-0000-4000-8000-000000000003',
        first_name: 'Amit',
        last_name: 'Kumar',
        gender: 'male',
        birth_date: '1988-03-21'
    },
    {
        id: 'c2000000-0000-4000-8000-000000000004',
        first_name: 'Neha',
        last_name: 'Verma',
        gender: 'female',
        birth_date: '1996-08-09'
    },
    {
        id: 'c2000000-0000-4000-8000-000000000005',
        first_name: 'Vickey',
        last_name: 'Kumar',
        gender: 'male',
        birth_date: '1990-01-15'
    }
];

const run = async () => {
    const owner = await ensureAuthUser({
        email: 'owner@admin.com',
        password: DEMO.password,
        first_name: 'Owner',
        last_name: 'Admin'
    });

    await upsert('family_spaces', {
        id: SPACE_ID,
        owner_id: owner.id,
        name: 'Sharma Find-Yourself Clan',
        description: 'Searchable demo family for Find Yourself join flow.',
        code: 'FIND-DEMO',
        status: 'active',
        visibility: 'Listed on marketplace',
        region: 'India',
        category: 'clan',
        contact_email: 'owner@admin.com',
        max_members: 200,
        subscription_tier: 'free',
        settings: {
            demo: true,
            tag: 'find-yourself',
            externalSearchIndexing: true,
            globalProfileVisibility: true
        },
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    await upsert('clan_trees', {
        id: TREE_ID,
        family_space_id: SPACE_ID,
        name: 'Sharma Main Tree'
    }, { onConflict: 'id' });

    // Also open the main Chen demo space to external search.
    await sb
        .from('family_spaces')
        .update({
            visibility: 'Listed on marketplace',
            settings: {
                demo: true,
                tag: DEMO.tag,
                governance_locked: false,
                externalSearchIndexing: true,
                globalProfileVisibility: true
            }
        })
        .eq('id', DEMO.spaceId);

    await sb
        .from('persons')
        .update({ claimed_by: null, privacy_mode: 'public' })
        .in('id', [DEMO.persons.uncle, DEMO.persons.aunt, DEMO.persons.pending]);

    await upsert('persons', PEOPLE.map((p) => ({
        id: p.id,
        clan_tree_id: TREE_ID,
        family_space_id: SPACE_ID,
        first_name: p.first_name,
        last_name: p.last_name,
        full_name: `${p.first_name} ${p.last_name}`,
        gender: p.gender,
        birth_date: p.birth_date,
        date_of_birth: p.birth_date,
        is_alive: true,
        claimed_by: null,
        privacy_mode: 'public',
        status: 'active',
        role: 'member',
        bio: `${p.first_name} ${p.last_name} is available to claim via Find Yourself.`
    })), { onConflict: 'id' });

    const { data, error } = await sb
        .from('persons')
        .select('id, full_name, gender, birth_date, claimed_by, privacy_mode')
        .eq('family_space_id', SPACE_ID)
        .is('claimed_by', null);

    if (error) throw error;
    log('find-yourself people:', data);
    log('Try: GET /api/families/find-yourself?first_name=Rahul');
    log('Try: GET /api/families/find-yourself?last_name=Sharma');
    log('Try: GET /api/families/find-yourself?first_name=Vickey&last_name=Kumar');
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
