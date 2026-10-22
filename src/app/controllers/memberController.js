import { supabase } from '../../config/supabaseClient.js';

/**
 * Get all members of a family space for the App
 * Supports filtering by "families" (blood/marriage) and "people" (friends/neighbors)
 */
export const getAppMembers = async (req, res) => {
    try {
        const { family_space_id, filter } = req.query;

        if (!family_space_id) {
            return res.status(400).json({ error: 'family_space_id is required' });
        }

        // Fetch all persons in the given family space
        const { data: persons, error: pError } = await supabase
            .from('persons')
            .select('id, full_name, first_name, last_name, avatar_url, role, birth_date, death_date, claimed_by')
            .eq('family_space_id', family_space_id);

        if (pError) throw pError;

        if (!persons || persons.length === 0) {
            return res.json([]);
        }

        const personIds = persons.map(p => p.id);
        
        // Fetch relations for these persons to determine connection tags
        const { data: relations, error: rError } = await supabase
            .from('person_relations')
            .select('person_id_1, person_id_2, relation_type')
            .or(`person_id_1.in.(${personIds.join(',')}),person_id_2.in.(${personIds.join(',')})`);

        if (rError) throw rError;

        // Process persons and categorize them
        const enrichedPersons = persons.map(person => {
            let relationTag = person.role || 'Member'; 
            let isPeople = false;

            // Check role first
            if (person.role && (person.role.toLowerCase() === 'friend' || person.role.toLowerCase() === 'neighbor')) {
                isPeople = true;
                relationTag = person.role;
            }

            // Check explicit relations
            const personRels = relations.filter(r => r.person_id_1 === person.id || r.person_id_2 === person.id);
            for (let rel of personRels) {
                if (rel.relation_type) {
                    const type = rel.relation_type.toLowerCase();
                    if (type === 'friend' || type === 'neighbor') {
                        isPeople = true;
                        relationTag = rel.relation_type;
                        break;
                    } else if (relationTag.toLowerCase() === 'member') {
                        // Use the relation as the tag if the person just has a generic 'member' role
                        relationTag = rel.relation_type;
                    }
                }
            }

            // Format years string "YYYY - Present"
            let years = 'Unknown';
            if (person.birth_date) {
                const birthYear = person.birth_date.split('-')[0];
                const deathYear = person.death_date ? person.death_date.split('-')[0] : 'Present';
                years = `${birthYear} - ${deathYear}`;
            }

            return {
                id: person.id,
                person_id: person.id,
                full_name: person.full_name || `${person.first_name || ''} ${person.last_name || ''}`.trim(),
                avatar_url: person.avatar_url,
                relation_tag: relationTag.charAt(0).toUpperCase() + relationTag.slice(1),
                years: years,
                is_family: !isPeople,
                claimed_by: person.claimed_by || null,
                user_id: person.claimed_by || null,
                is_claimed: Boolean(person.claimed_by)
            };
        });

        // Apply filter if provided
        let filteredPersons = enrichedPersons;
        if (filter === 'families') {
            filteredPersons = enrichedPersons.filter(p => p.is_family);
        } else if (filter === 'people') {
            filteredPersons = enrichedPersons.filter(p => !p.is_family);
        }

        res.json(filteredPersons);

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const cleanSearch = (value) => String(value || '').replace(/[%_,]/g, '').trim().slice(0, 60);

/**
 * Find people who are not already in this family, so they can be added to the tree.
 * GET /api/app/members/discover?family_space_id=&q=
 */
export const discoverOutsideMembers = async (req, res) => {
    try {
        const familySpaceId = req.query.family_space_id;
        const q = cleanSearch(req.query.q);
        if (!familySpaceId) return res.status(400).json({ error: 'family_space_id is required' });
        if (q.length < 2) return res.json([]);

        const { data: membership } = await supabase
            .from('family_memberships')
            .select('id')
            .eq('family_space_id', familySpaceId)
            .eq('user_id', req.user.id)
            .maybeSingle();
        if (!membership) return res.status(403).json({ error: 'Access denied' });

        const { data: insideMembers } = await supabase
            .from('family_memberships')
            .select('user_id')
            .eq('family_space_id', familySpaceId);
        const insideUserIds = new Set((insideMembers || []).map((row) => row.user_id).filter(Boolean));

        const { data: trees } = await supabase.from('clan_trees').select('id').eq('family_space_id', familySpaceId);
        const treeIds = new Set((trees || []).map((tree) => tree.id));
        const insideEmails = new Set();
        if (treeIds.size) {
            const { data: insidePersons } = await supabase
                .from('persons')
                .select('email, claimed_by')
                .in('clan_tree_id', [...treeIds]);
            for (const person of insidePersons || []) {
                if (person.claimed_by) insideUserIds.add(person.claimed_by);
                if (person.email) insideEmails.add(String(person.email).toLowerCase());
            }
        }

        const pattern = `%${q}%`;
        const { data: users, error: userError } = await supabase
            .from('users')
            .select('id, first_name, last_name, email, avatar_url')
            .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern}`)
            .limit(30);
        if (userError) throw userError;

        const { data: people, error: personError } = await supabase
            .from('persons')
            .select('id, full_name, email, avatar_url, clan_tree_id, claimed_by')
            .ilike('full_name', pattern)
            .limit(30);
        if (personError) throw personError;

        const needle = q.toLowerCase();
        const results = [];
        const seen = new Set();

        for (const user of users || []) {
            const email = String(user.email || '').toLowerCase();
            const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
            const haystack = `${name} ${email}`.toLowerCase();
            if (!haystack.includes(needle)) continue;
            if (insideUserIds.has(user.id) || (email && insideEmails.has(email))) continue;
            if (seen.has(`user:${user.id}`)) continue;
            seen.add(`user:${user.id}`);
            results.push({
                id: user.id,
                user_id: user.id,
                person_id: null,
                full_name: name || user.email,
                email: user.email || null,
                avatar_url: user.avatar_url || null,
                relation_tag: 'Outside family',
                outside: true
            });
        }

        for (const person of people || []) {
            if (treeIds.has(person.clan_tree_id)) continue;
            if (person.claimed_by && insideUserIds.has(person.claimed_by)) continue;
            const email = String(person.email || '').toLowerCase();
            if (email && insideEmails.has(email)) continue;
            const key = person.claimed_by ? `user:${person.claimed_by}` : `person:${person.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({
                id: person.claimed_by || person.id,
                user_id: person.claimed_by || null,
                person_id: person.id,
                full_name: person.full_name,
                email: person.email || null,
                avatar_url: person.avatar_url || null,
                relation_tag: 'Outside family',
                outside: true
            });
        }

        res.json(results.slice(0, 12));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

/**
 * Copy an outside account onto this family's tree.
 * POST /api/app/members/add-to-tree  { family_space_id, user_id }
 */
export const addOutsideMemberToTree = async (req, res) => {
    try {
        const familySpaceId = req.body.family_space_id;
        const userId = req.body.user_id || null;
        const sourcePersonId = req.body.person_id || null;
        if (!familySpaceId || (!userId && !sourcePersonId)) {
            return res.status(400).json({ error: 'family_space_id and user_id or person_id are required' });
        }

        const { data: membership } = await supabase
            .from('family_memberships')
            .select('id')
            .eq('family_space_id', familySpaceId)
            .eq('user_id', req.user.id)
            .maybeSingle();
        if (!membership) return res.status(403).json({ error: 'Access denied' });

        let account = null;
        if (userId) {
            const { data, error: accountError } = await supabase
                .from('users')
                .select('id, first_name, last_name, email, avatar_url')
                .eq('id', userId)
                .maybeSingle();
            if (accountError) throw accountError;
            account = data;
        }
        let sourcePerson = null;
        if (!account && sourcePersonId) {
            const { data, error: personError } = await supabase
                .from('persons')
                .select('id, full_name, email, avatar_url, claimed_by')
                .eq('id', sourcePersonId)
                .maybeSingle();
            if (personError) throw personError;
            sourcePerson = data;
        }
        if (!account && !sourcePerson) return res.status(404).json({ error: 'Person not found' });

        const { data: trees } = await supabase.from('clan_trees').select('id').eq('family_space_id', familySpaceId).limit(1);
        const treeId = trees?.[0]?.id;
        if (!treeId) return res.status(400).json({ error: 'This family has no tree yet' });

        const claimedBy = account?.id || sourcePerson?.claimed_by || null;
        if (claimedBy) {
            const { data: existing } = await supabase
                .from('persons')
                .select('id, full_name')
                .eq('clan_tree_id', treeId)
                .eq('claimed_by', claimedBy)
                .maybeSingle();
            if (existing) {
                return res.json({ message: 'Already on this family tree', person: existing });
            }
        }

        const fullName = account
            ? (`${account.first_name || ''} ${account.last_name || ''}`.trim() || account.email)
            : sourcePerson.full_name;
        const { data: created, error: insertError } = await supabase
            .from('persons')
            .insert({
                clan_tree_id: treeId,
                family_space_id: familySpaceId,
                full_name: fullName,
                email: account?.email || sourcePerson?.email || null,
                avatar_url: account?.avatar_url || sourcePerson?.avatar_url || null,
                claimed_by: claimedBy,
                status: 'active'
            })
            .select('id, full_name')
            .single();
        if (insertError) throw insertError;

        res.status(201).json({ message: 'Added to the family tree', person: created });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
