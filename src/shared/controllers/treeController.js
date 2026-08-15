import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';

/**
 * Internal Helper: Enforce Branch Governance rules.
 */
async function checkBranchGovernance(branchId, userId, familyRole, actionType) {
    if (!branchId) return true; // Global/no branch = standard family role check only (already done by middleware)

    const { data: branch } = await supabase
        .from('family_branches')
        .select('*')
        .eq('id', branchId)
        .single();

    if (!branch) return true;

    // Family Owners & Admins bypass branch restrictions
    if (familyRole === 'owner' || familyRole === 'admin') return true;

    if (actionType === 'ADD_MEMBER' && branch.can_add_members === 'head_only') {
        const { data: userRecord } = await supabase.from('users').select('person_id').eq('id', userId).single();
        if (userRecord?.person_id !== branch.head_person_id && userId !== branch.branch_admin_id) {
            throw new Error('GOVERNANCE: Only the Branch Head or Admin can add members to this branch.');
        }
    }

    // Add more checks (history, media) as needed
    return true;
}

/**
 * Internal Helper: Enforce Global Governance Rules (All 4 Modes)
 */
async function handleAdminControlledPending(user, familyRole, family_space_id, request_type, proposed_value, current_value = null) {
    const { data: config } = await supabase.from('system_configs').select('value').eq('key', 'GOVERNANCE_MODE').single();
    let mode = 'open_collaborative';
    if (config?.value) {
        let rawVal = config.value;
        if (typeof rawVal === 'string' && rawVal.startsWith('"')) rawVal = rawVal.replace(/^"|"$/g, '');
        mode = rawVal;
    }

    const isFamilyAdmin = ['owner', 'admin', 'co-admin', 'super_admin'].includes(familyRole);
    const isCouncil = ['council'].includes(familyRole);

    if (mode === 'locked_preservation') {
        if (!isFamilyAdmin) {
            return { blocked: true, message: 'This family tree is in Preservation Mode (View-Only). Edits are disabled.' };
        }
        return false;
    }

    if (mode === 'council_governed') {
        if (!isCouncil && familyRole !== 'super_admin') {
            await supabase.from('branch_edit_requests').insert({
                family_space_id,
                requested_by: user.id,
                request_type,
                proposed_value,
                current_value,
                status: 'pending_council',
                reason: `Auto-intercepted for Council approval.`
            });
            return { intercepted: true, target: 'Family Council' };
        }
        return false;
    }

    if (mode === 'admin_controlled') {
        if (!isFamilyAdmin) {
            await supabase.from('branch_edit_requests').insert({
                family_space_id,
                requested_by: user.id,
                request_type,
                proposed_value,
                current_value,
                status: 'pending',
                reason: `Auto-intercepted for Family Admin approval.`
            });
            return { intercepted: true, target: 'Family Admin' };
        }
        return false;
    }

    return false; // open_collaborative
}

async function getTargetPerson(targetPersonId, familySpaceId) {
    const { data, error } = await supabase
        .from('persons')
        .select('id, family_space_id, clan_tree_id')
        .eq('id', targetPersonId)
        .eq('family_space_id', familySpaceId)
        .maybeSingle();

    if (error) throw error;
    return data;
}

const normalizePersonEmail = (email) => {
    if (email == null || email === '') return null;
    const clean = String(email).trim().toLowerCase();
    return clean.includes('@') ? clean : null;
};

const personEmailField = (email) => {
    const normalized = normalizePersonEmail(email);
    return normalized ? { email: normalized } : {};
};

async function resolveFamilySpaceIdForUser(family_space_id, userId) {
    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(family_space_id);
    if (isValidUuid) return family_space_id;

    const { data: myMemberships } = await supabase
        .from('family_memberships')
        .select('family_space_id, role')
        .eq('user_id', userId);

    if (!myMemberships?.length) return null;
    const ownerSpace = myMemberships.find((m) => m.role === 'owner');
    return ownerSpace ? ownerSpace.family_space_id : myMemberships[0].family_space_id;
}

/**
 * Add a Parent to a specific target person.
 * Creates a new Person record and a 'parent' relationship edge.
 */
export const addParent = async (req, res) => {
    let createdParentId = null;
    try {
        const {
            family_space_id, target_person_id,
            first_name, last_name, gender, is_alive,
            date_of_birth, place_of_birth, anniversary_date,
            current_location, avatar_url, branch_id, email
        } = req.body;
        const { user, familyRole } = req;

        // Enforce Governance
        if (branch_id) {
            await checkBranchGovernance(branch_id, user.id, familyRole, 'ADD_MEMBER');
        }

        // Global Governance Intercept
        const governance = await handleAdminControlledPending(user, familyRole, family_space_id, 'add_parent', req.body);
        if (governance?.blocked) {
            return res.status(400).json({ error: governance.message, message: governance.message });
        }
        if (governance?.intercepted) {
            return res.status(202).json({ message: `Request sent to ${governance.target} for approval.` });
        }

        if (!family_space_id || !target_person_id || !first_name) {
            return res.status(400).json({
                error: 'family_space_id, target_person_id, and first_name are required'
            });
        }

        const targetPerson = await getTargetPerson(target_person_id, family_space_id);
        if (!targetPerson) {
            return res.status(404).json({
                error: 'Target person was not found in this family space'
            });
        }

        // 1. Create the Parent Person
        const { data: parent, error: pError } = await supabase
            .from('persons')
            .insert({
                family_space_id,
                first_name,
                last_name,
                full_name: `${first_name} ${last_name}`.trim(),
                gender,
                is_alive: is_alive === 'true' || is_alive === true,
                date_of_birth: date_of_birth || null,
                place_of_birth,
                anniversary_date: anniversary_date || null,
                current_location,
                avatar_url,
                branch_id: branch_id || null,
                ...personEmailField(email)
            })
            .select()
            .single();

        if (pError) throw pError;
        createdParentId = parent.id;

        // 2. Add Relationship: Parent -> Target (Child)
        const { error: rError } = await supabase
            .from('person_relations')
            .insert({
                clan_tree_id: targetPerson.clan_tree_id || null,
                person_id_1: parent.id, // Source is Parent
                person_id_2: target_person_id, // Target is Child
                relation_type: 'parent'
            });
        if (rError) throw rError;

        // Sync parent to the same tree if they aren't already
        if (targetPerson.clan_tree_id) {
            await supabase.from('persons').update({ clan_tree_id: targetPerson.clan_tree_id }).eq('id', parent.id);
        }

        await logActivity(user.id, 'ADD_PARENT', 'persons', parent.id, family_space_id);
        res.status(201).json(parent);
    } catch (err) {
        // Avoid leaving an orphan person when relationship creation fails.
        if (createdParentId) {
            await supabase.from('persons').delete().eq('id', createdParentId);
        }
        res.status(500).json({ error: err.message });
    }
};

/**
 * Add a Child to a specific target person.
 * Creates a new Person record and a 'parent' relationship edge from target to child.
 */
export const addChild = async (req, res) => {
    let createdChildId = null;
    try {
        const {
            family_space_id, target_person_id,
            first_name, last_name, gender, is_alive,
            date_of_birth, place_of_birth, anniversary_date,
            current_location, avatar_url,
            school_college, qualification, study_location, branch_id, email
        } = req.body;
        const { user, familyRole } = req;

        // Enforce Governance
        if (branch_id) {
            await checkBranchGovernance(branch_id, user.id, familyRole, 'ADD_MEMBER');
        }

        // Global Governance Intercept
        const governance = await handleAdminControlledPending(user, familyRole, family_space_id, 'add_child', req.body);
        if (governance?.blocked) {
            return res.status(400).json({ error: governance.message, message: governance.message });
        }
        if (governance?.intercepted) {
            return res.status(202).json({ message: `Request sent to ${governance.target} for approval.` });
        }

        if (!family_space_id || !target_person_id || !first_name) {
            return res.status(400).json({
                error: 'family_space_id, target_person_id, and first_name are required'
            });
        }

        const targetPerson = await getTargetPerson(target_person_id, family_space_id);
        if (!targetPerson) {
            return res.status(404).json({
                error: 'Target person was not found in this family space'
            });
        }

        // 1. Create the Child Person
        const { data: child, error: cError } = await supabase
            .from('persons')
            .insert({
                family_space_id,
                first_name,
                last_name,
                full_name: `${first_name} ${last_name}`.trim(),
                gender,
                is_alive: is_alive === 'true' || is_alive === true,
                date_of_birth: date_of_birth || null,
                place_of_birth,
                anniversary_date: anniversary_date || null,
                current_location,
                avatar_url,
                school_college,
                qualification,
                study_location,
                branch_id: branch_id || null,
                ...personEmailField(email)
            })
            .select()
            .single();

        if (cError) throw cError;
        createdChildId = child.id;

        // 2. Add Relationship: Target (Parent) -> Child
        const { error: rError } = await supabase
            .from('person_relations')
            .insert({
                clan_tree_id: targetPerson.clan_tree_id || null,
                person_id_1: target_person_id, // Source is Parent
                person_id_2: child.id, // Target is Child
                relation_type: 'parent'
            });
        if (rError) throw rError;

        // Sync child to the same tree
        if (targetPerson.clan_tree_id) {
            await supabase.from('persons').update({ clan_tree_id: targetPerson.clan_tree_id }).eq('id', child.id);
        }

        await logActivity(user.id, 'ADD_CHILD', 'persons', child.id, family_space_id);
        res.status(201).json(child);
    } catch (err) {
        if (createdChildId) {
            await supabase.from('persons').delete().eq('id', createdChildId);
        }
        res.status(500).json({ error: err.message });
    }
};

/**
 * Add a generic Family Member with a specific relationship.
 */
export const addFamilyMember = async (req, res) => {
    let createdPersonId = null;
    try {
        const {
            family_space_id, target_person_id, relationship_type,
            first_name, last_name, gender, is_alive,
            date_of_birth, anniversary_date, place_of_birth,
            occupation, bio_notes, profile_visibility,
            hide_sensitive_details, avatar_url, link_existing_id, branch_id, email
        } = req.body;
        const { user, familyRole } = req;

        // Enforce Governance
        if (branch_id) {
            await checkBranchGovernance(branch_id, user.id, familyRole, 'ADD_MEMBER');
        }

        // Global Governance Intercept
        const governance = await handleAdminControlledPending(user, familyRole, family_space_id, 'add_family_member', req.body);
        if (governance?.blocked) {
            return res.status(400).json({ error: governance.message, message: governance.message });
        }
        if (governance?.intercepted) {
            return res.status(202).json({ message: `Request sent to ${governance.target} for approval.` });
        }

        if (!family_space_id || (!link_existing_id && !first_name)) {
            return res.status(400).json({
                error: 'family_space_id and first_name are required when creating a person'
            });
        }
        if ((target_person_id && !relationship_type) || (!target_person_id && relationship_type)) {
            return res.status(400).json({
                error: 'target_person_id and relationship_type must be provided together'
            });
        }

        let targetPerson = null;
        if (target_person_id) {
            targetPerson = await getTargetPerson(target_person_id, family_space_id);
            if (!targetPerson) {
                return res.status(404).json({
                    error: 'Target person was not found in this family space'
                });
            }
        }

        let personId = link_existing_id;

        if (personId) {
            const existingPerson = await getTargetPerson(personId, family_space_id);
            if (!existingPerson) {
                return res.status(404).json({
                    error: 'Linked person was not found in this family space'
                });
            }
        } else {
            // Create new person if not linking
            const { data: person, error: pError } = await supabase
                .from('persons')
                .insert({
                    family_space_id,
                    first_name,
                    last_name,
                    full_name: `${first_name} ${last_name}`.trim(),
                    gender,
                    is_alive: is_alive === 'true' || is_alive === true,
                    date_of_birth: date_of_birth || null,
                    anniversary_date: anniversary_date || null,
                    place_of_birth,
                    occupation,
                    bio_notes,
                    profile_visibility,
                    hide_sensitive_details: hide_sensitive_details === 'true' || hide_sensitive_details === true,
                    avatar_url,
                    branch_id: branch_id || null,
                    ...personEmailField(email)
                })
                .select()
                .single();

            if (pError) throw pError;
            personId = person.id;
            createdPersonId = person.id;
        }

        // Add Relationship Edge
        if (target_person_id && relationship_type) {
            // Determine orientation based on type
            let sourceId = personId;
            let targetId = target_person_id;
            let type = relationship_type.toLowerCase();

            if (type === 'child') {
                sourceId = target_person_id;
                targetId = personId;
                type = 'parent';
            }

            const { error: rError } = await supabase
                .from('person_relations')
                .insert({
                    clan_tree_id: targetPerson.clan_tree_id || null,
                    person_id_1: sourceId,
                    person_id_2: targetId,
                    relation_type: type
                });
            if (rError) throw rError;

            // Sync person to the same tree
            if (targetPerson.clan_tree_id) {
                await supabase.from('persons').update({ clan_tree_id: targetPerson.clan_tree_id }).eq('id', personId);
            }
        }

        await logActivity(user.id, 'ADD_MEMBER', 'persons', personId, family_space_id);
        res.status(201).json({ id: personId, message: 'Member added successfully' });
    } catch (err) {
        if (createdPersonId) {
            await supabase.from('persons').delete().eq('id', createdPersonId);
        }
        res.status(500).json({ error: err.message });
    }
};

/**
 * Search for members in the tree.
 */
export const searchTreeMembers = async (req, res) => {
    try {
        const { family_space_id, query } = req.query;

        if (!family_space_id) return res.status(400).json({ error: 'family_space_id is required' });

        // Deep Recovery: Fetch tree IDs linked to this space
        const { data: trees } = await supabase
            .from('clan_trees')
            .select('id')
            .eq('family_space_id', family_space_id);

        const treeIds = trees?.map(t => t.id) || [];

        let dbQuery = supabase
            .from('persons')
            .select('*');

        // Search by Space ID OR Tree IDs
        if (treeIds.length > 0) {
            dbQuery = dbQuery.or(`family_space_id.eq.${family_space_id},clan_tree_id.in.(${treeIds.join(',')})`);
        } else {
            dbQuery = dbQuery.eq('family_space_id', family_space_id);
        }

        if (query) {
            // Combine with name filter. PostgREST .or() syntax for complex conditions:
            // (family_space_id.eq.X) AND (full_name.ilike.Y, ...)
            // However, Supabase .or is for OR conditions at that level.
            // We'll use a more surgical approach:
            dbQuery = dbQuery.or(`full_name.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`);
        }

        let { data: persons, error } = await dbQuery.limit(50);
        if (error) throw error;

        // Role-Aware Search Supplement
        if (query) {
            // A. Search memberships for matching roles
            const { data: roleMatches } = await supabase
                .from('family_memberships')
                .select('user_id, role')
                .eq('family_space_id', family_space_id)
                .ilike('role', `%${query}%`);

            // B. Search Users table for name/email matches
            const { data: userMatches } = await supabase
                .from('users')
                .select('id')
                .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`);

            const userIdsFromNames = userMatches?.map(u => u.id) || [];

            // Filter those users to only those in the current space
            let memberMatches = [];
            if (userIdsFromNames.length > 0) {
                const { data: m } = await supabase
                    .from('family_memberships')
                    .select('user_id, role')
                    .eq('family_space_id', family_space_id)
                    .in('user_id', userIdsFromNames);
                memberMatches = m || [];
            }

            const allMemberMatches = [...(roleMatches || []), ...memberMatches];
            const uniqueUserIds = [...new Set(allMemberMatches.map(m => m.user_id))];

            if (uniqueUserIds.length > 0) {
                const existingPersonIds = persons.map(p => p.id);
                // Users who have claimed a node
                const { data: claimedPersons } = await supabase
                    .from('persons')
                    .select('*')
                    .in('claimed_by', uniqueUserIds);

                const userIdsWithClaim = new Set();

                if (claimedPersons) {
                    claimedPersons.forEach(cp => {
                        userIdsWithClaim.add(cp.claimed_by);
                        if (!existingPersonIds.includes(cp.id)) {
                            const member = allMemberMatches.find(m => m.user_id === cp.claimed_by);
                            if (member) cp.full_name = `${cp.full_name} (${member.role})`;
                            persons.push(cp);
                        } else {
                            const pIndex = persons.findIndex(p => p.id === cp.id);
                            const member = allMemberMatches.find(m => m.user_id === cp.claimed_by);
                            if (member && !persons[pIndex].full_name.includes(`(${member.role})`)) {
                                persons[pIndex].full_name = `${persons[pIndex].full_name} (${member.role})`;
                            }
                        }
                    });
                }

                allMemberMatches.forEach(match => {
                    if (!userIdsWithClaim.has(match.user_id)) {
                        // This is a member of the space with no tree node.
                        // We synthesize a "Virtual Node" for them so they can be assigned as Branch Admin.
                        persons.push({
                            id: match.user_id, // We use User ID here, backend save will resolve this
                            full_name: `${match.users?.first_name || 'Member'} ${match.users?.last_name || ''} (${match.role} - Unlinked)`.trim(),
                            first_name: match.users?.first_name,
                            last_name: match.users?.last_name,
                            email: match.users?.email || null,
                            is_virtual: true,
                            user_id: match.user_id
                        });
                    }
                });
            }
        }

        // Enrich persons with email from users table if claimed_by or user_id exists
        const userIdsToLookup = [...new Set(persons.map(p => p.claimed_by || p.user_id).filter(Boolean))];
        let userEmailMap = new Map();
        if (userIdsToLookup.length > 0) {
            const { data: uDocs } = await supabase
                .from('users')
                .select('id, email')
                .in('id', userIdsToLookup);
            (uDocs || []).forEach(u => userEmailMap.set(u.id, u.email));
        }
        persons.forEach(p => {
            if (!p.email && (p.claimed_by || p.user_id)) {
                p.email = userEmailMap.get(p.claimed_by || p.user_id) || null;
            }
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json(persons);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get full Tree Data (Nodes + Relationships) for a specific family space.
 * Accessible by Space Members OR Platform Admins.
 */
export const getTreeData = async (req, res) => {
    try {
        let { family_space_id } = req.query;
        const { user, adminRole } = req;

        // ── Smart Family Space Resolution (mirrors getMembers logic) ──
        const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(family_space_id);

        if (!isValidUuid) {
            // Provided ID is missing, invalid, or a placeholder like 'DEFAULT_FAMILY_ID'
            // Auto-detect from user's memberships, preferring the space they own
            const { data: myMemberships } = await supabase
                .from('family_memberships')
                .select('family_space_id, role')
                .eq('user_id', user.id);

            if (myMemberships?.length > 0) {
                const ownerSpace = myMemberships.find(m => m.role === 'owner');
                family_space_id = ownerSpace
                    ? ownerSpace.family_space_id
                    : myMemberships[0].family_space_id;
                console.log(`[getTreeData] Auto-detected family_space_id: ${family_space_id} (role: ${ownerSpace ? 'owner' : myMemberships[0].role})`);
            }
        }

        if (!family_space_id) {
            return res.status(400).json({ error: 'Could not determine family_space_id' });
        }

        console.log(`[getTreeData] Fetching tree for family_space_id: ${family_space_id}`);

        // RBAC: non-admin must be a member of this space
        if (!adminRole) {
            const { data: membership } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('family_space_id', family_space_id)
                .eq('user_id', user.id)
                .maybeSingle();

            if (!membership) {
                return res.status(403).json({ error: 'Access denied. You are not a member of this family space.' });
            }
        }


        // ── 1. Fetch real persons (has DOB, relationships, profile data) ──
        const { data: pDirect, error: pError } = await supabase
            .from('persons')
            .select('*, family_branches:branch_id (name)')
            .eq('family_space_id', family_space_id);
        if (pError) throw pError;

        // ── 1b. Also try via clan_trees (legacy path) ──
        let personsFromTree = [];
        const { data: trees } = await supabase
            .from('clan_trees')
            .select('id')
            .eq('family_space_id', family_space_id);
        const treeIds = trees?.map(t => t.id) || [];
        if (treeIds.length > 0) {
            const { data: tp } = await supabase
                .from('persons')
                .select('*, family_branches:branch_id (name)')
                .in('clan_tree_id', treeIds);
            personsFromTree = tp || [];
        }

        // Merge both persons sources (deduplicate by id)
        const personIdsSeen = new Set();
        const allPersons = [];
        for (const p of [...(pDirect || []), ...personsFromTree]) {
            if (!personIdsSeen.has(p.id)) {
                personIdsSeen.add(p.id);
                allPersons.push(p);
            }
        }

        // ── 2. ALWAYS merge with family_memberships ──
        // Split into two queries to avoid silent FK join issues.
        // Step A: get all user_ids in this family space
        const { data: memberships, error: memErr } = await supabase
            .from('family_memberships')
            .select('user_id, role, status')
            .eq('family_space_id', family_space_id);

        console.log(`[getTreeData] memberships count: ${memberships?.length ?? 'error'}`, memErr?.message);

        // Set of user_ids already represented by a real persons record
        const claimedUserIds = new Set(
            allPersons.filter(p => p.claimed_by).map(p => p.claimed_by)
        );
        const personIdsSet = new Set(allPersons.map(p => p.id));

        if (memberships && memberships.length > 0) {
            // Step B: get user profile details for those user_ids
            // Guard: filter out any null/undefined user_ids
            const memberUserIds = memberships.map(m => m.user_id).filter(Boolean);

            let userProfiles = [];
            if (memberUserIds.length > 0) {
                const { data: up, error: upErr } = await supabase
                    .from('users')
                    .select('id, first_name, last_name, email, avatar_url')
                    .in('id', memberUserIds);
                if (upErr) console.warn('[getTreeData] users fetch error:', upErr.message);
                userProfiles = up || [];
            }

            console.log(`[getTreeData] userProfiles count: ${userProfiles.length}`);

            const userMap = new Map(userProfiles.map(u => [u.id, u]));

            for (const m of memberships) {
                if (!m.user_id) continue; // skip null user_ids
                // Skip if this member already has a person node
                if (claimedUserIds.has(m.user_id) || personIdsSet.has(m.user_id)) continue;
                const u = userMap.get(m.user_id) || {};
                const firstName = u.first_name || '';
                const lastName = u.last_name || '';
                const fullName = `${firstName} ${lastName}`.trim() || u.email || 'Unknown Member';
                allPersons.push({
                    id: m.user_id,
                    first_name: firstName,
                    last_name: lastName,
                    full_name: fullName,
                    avatar_url: u.avatar_url || null,
                    family_space_id,
                    claimed_by: m.user_id,
                    occupation: m.role || 'Family Member',
                    is_alive: true,
                    is_synthesized: true,
                });
            }
        }



        // Get all clan_tree_ids for this family_space
        const { data: allTrees } = await supabase
            .from('clan_trees')
            .select('id')
            .eq('family_space_id', family_space_id);
        const allTreeIds = allTrees?.map(t => t.id) || [];
        const allPersonIds = allPersons.map(p => p.id);

        let normalizedRelations = [];

        const { data: rels, error: rErr } = await supabase
            .from('person_relations')
            .select('*')
            .eq('clan_tree_id', allTreeIds[0] || null); // Primary tree search
        
        // Fallback: If no tree ID, search by person IDs in space
        const { data: relsByPerson } = await supabase
            .from('person_relations')
            .select('*')
            .or(`person_id_1.in.(${allPersonIds.join(',')}),person_id_2.in.(${allPersonIds.join(',')})`);

        const combinedRels = [...(rels || []), ...(relsByPerson || [])];
        const relIdsSeen = new Set();
        
        normalizedRelations = combinedRels.filter(r => {
            if (relIdsSeen.has(r.id)) return false;
            relIdsSeen.add(r.id);
            return true;
        }).map(r => ({
            id: r.id,
            person_id: r.person_id_1,
            related_person_id: r.person_id_2,
            relationship_type: r.relation_type,
            relation_type: r.relation_type,
            clan_tree_id: r.clan_tree_id,
            family_space_id,
        }));

        // Also check person_relationships (legacy table from treeController.addChild/addParent)
        const { data: rels2 } = await supabase
            .from('person_relationships')
            .select('*')
            .eq('family_space_id', family_space_id);

        // Merge both, deduplicate by id
        (rels2 || []).forEach(r => {
            if (!relIdsSeen.has(r.id)) {
                relIdsSeen.add(r.id);
                normalizedRelations.push(r); // already has correct field names
            }
        });
        
        // Apply Sensitive Data Redaction from Council Privacy Settings
        const { data: space } = await supabase.from('family_spaces').select('settings').eq('id', family_space_id).single();
        const settings = space?.settings || {};
        
        // Build graph for descendant check if postMortemAccess is enabled
        const childrenMap = new Map();
        if (settings.sensitiveDataRedaction && settings.postMortemAccess) {
            normalizedRelations.forEach(r => {
                if (r.relationship_type === 'parent' || r.relation_type === 'parent') {
                    if (!childrenMap.has(r.person_id)) childrenMap.set(r.person_id, []);
                    childrenMap.get(r.person_id).push(r.related_person_id);
                }
            });
        }
        
        const userNode = allPersons.find(p => p.claimed_by === user.id);
        const userIdNode = userNode ? userNode.id : null;

        const isDescendant = (ancestorId, targetId) => {
            if (!targetId) return false;
            let queue = [ancestorId];
            let visited = new Set();
            while (queue.length > 0) {
                const curr = queue.shift();
                if (curr === targetId) return true;
                if (visited.has(curr)) continue;
                visited.add(curr);
                const children = childrenMap.get(curr) || [];
                queue.push(...children);
            }
            return false;
        };

        if (settings.sensitiveDataRedaction) {
            allPersons.forEach(p => {
                // Post-Mortem Access rule: Skip redaction for deceased ancestors of the current user
                if (settings.postMortemAccess && p.is_alive === false && isDescendant(p.id, userIdNode)) {
                    return; // Skip redaction
                }

                if (p.date_of_birth) p.date_of_birth = p.date_of_birth.substring(0, 4) + '-01-01'; // Keep only year, fake M/D for standard parsing
                if (p.latitude) p.latitude = null;
                if (p.longitude) p.longitude = null;
                if (p.current_location) p.current_location = '[REDACTED]';
                if (p.place_of_birth) p.place_of_birth = '[REDACTED]';
                if (p.dna_markers) p.dna_markers = '[REDACTED]';
            });
        }

        console.log(`[getTreeData] Sending ${allPersons.length} persons and ${normalizedRelations.length} relations`);
        normalizedRelations.forEach(r => {
            const p1 = allPersons.find(p => p.id === r.person_id);
            const p2 = allPersons.find(p => p.id === r.related_person_id);
            console.log(`[REL] ${p1?.full_name || r.person_id} -> ${p2?.full_name || r.related_person_id} (${r.relationship_type})`);
        });

        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });

        res.json({
            persons: allPersons,
            relationships: normalizedRelations
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update a person's profile data
 */
export const updatePerson = async (req, res) => {
    try {
        const { person_id } = req.params;
        const updates = { ...req.body };
        const { user } = req;

        // Sanitize - remove fields that shouldn't be updated via this simple endpoint
        delete updates.id;
        delete updates.created_at;
        delete updates.family_space_id;
        delete updates.clan_tree_id;

        // Global Governance Intercept
        const { data: currentPerson } = await supabase.from('persons').select('*').eq('id', person_id).single();
        const family_space_id = currentPerson?.family_space_id;
        
        const governance = await handleAdminControlledPending(user, req.familyRole, family_space_id, 'edit_member', updates, currentPerson);
        if (governance?.blocked) {
            return res.status(400).json({ error: governance.message, message: governance.message });
        }
        if (governance?.intercepted) {
            return res.status(202).json({ message: `Update sent to ${governance.target} for approval.` });
        }

        const { data, error } = await supabase
            .from('persons')
            .update(updates)
            .eq('id', person_id)
            .select()
            .single();

        if (error) throw error;

        await logActivity(user.id, 'UPDATE_PERSON', 'persons', person_id, data.family_space_id);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /tree/webview-url — signed-in mobile app URL for admin family-tree WebView.
 * Returns https://uat-admin.kincore.com/family-tree/webview/{family_space_id}?view=app&token=...
 */
export const getTreeWebviewUrl = async (req, res) => {
    try {
        const { user } = req;
        let { family_space_id: familySpaceId } = req.query;

        familySpaceId = await resolveFamilySpaceIdForUser(familySpaceId, user.id);
        if (!familySpaceId) {
            return res.status(400).json({ error: 'Could not determine family_space_id' });
        }

        const authHeader = String(req.headers.authorization || '');
        const bearerToken = authHeader.startsWith('Bearer ')
            ? authHeader.slice(7).trim()
            : String(req.query.token || '').trim();

        if (!bearerToken) {
            return res.status(401).json({ error: 'Bearer token required' });
        }

        const { data: membership } = await supabase
            .from('family_memberships')
            .select('role')
            .eq('family_space_id', familySpaceId)
            .eq('user_id', user.id)
            .maybeSingle();

        if (!membership) {
            return res.status(403).json({ error: 'Access denied. You are not a member of this family space.' });
        }

        const frontendBase = String(process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
        const params = new URLSearchParams({
            view: 'app',
            token: bearerToken
        });
        const url = `${frontendBase}/family-tree/webview/${familySpaceId}?${params.toString()}`;

        res.json({
            url,
            family_space_id: familySpaceId,
            web_app_base: frontendBase
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
