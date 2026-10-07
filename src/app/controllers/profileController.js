import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';

const PROFILE_USER_COLUMNS =
    'first_name, last_name, avatar_url, bio, date_of_birth, place_of_birth, occupation, gender, company_name, website, linkedin, instagram, facebook, other_link';

const COMPANY_LINK_FIELDS = [
    'company_name',
    'website',
    'linkedin',
    'instagram',
    'facebook',
    'other_link'
];

const pickCompanyLinks = (user = {}) => ({
    company_name: user.company_name ?? null,
    website: user.website ?? null,
    linkedin: user.linkedin ?? null,
    instagram: user.instagram ?? null,
    facebook: user.facebook ?? null,
    other_link: user.other_link ?? null
});

const extractCompanyLinkUpdates = (body = {}) => {
    const updates = {};
    const aliases = {
        company_name: ['company_name', 'companyName', 'company name'],
        website: ['website'],
        linkedin: ['linkedin', 'linked_in', 'linkedIn'],
        instagram: ['instagram'],
        facebook: ['facebook'],
        other_link: ['other_link', 'otherLink', 'other link']
    };

    for (const field of COMPANY_LINK_FIELDS) {
        const keys = aliases[field] || [field];
        for (const key of keys) {
            if (body[key] !== undefined) {
                updates[field] = body[key];
                break;
            }
        }
    }
    return updates;
};

/**
 * Helper: Build Family Tree Graph to find relatives
 */
async function getRelatives(personId, spaceId) {
    if (!personId) return [];

    // 1. Fetch all persons in the space
    const { data: persons } = await supabase
        .from('persons')
        .select('*')
        .eq('family_space_id', spaceId);

    if (!persons || persons.length === 0) return [];

    const personMap = new Map(persons.map(p => [p.id, p]));

    // 2. Fetch relations
    const personIds = persons.map(p => p.id);
    const { data: relations } = await supabase
        .from('person_relations')
        .select('*')
        .or(`person_id_1.in.(${personIds.join(',')}),person_id_2.in.(${personIds.join(',')})`);

    const relatives = [];

    (relations || []).forEach(rel => {
        if (rel.person_id_1 === personId) {
            // person_id_1 is me
            const other = personMap.get(rel.person_id_2);
            if (!other) return;
            let type = rel.relation_type;
            if (type === 'parent') type = other.gender === 'male' ? 'Son' : 'Daughter'; // I am parent to other -> other is my child
            else if (type === 'spouse') type = other.gender === 'male' ? 'Husband' : 'Wife';
            else if (type === 'sibling') type = other.gender === 'male' ? 'Brother' : 'Sister';
            relatives.push({ ...other, relationToMe: type });
        } else if (rel.person_id_2 === personId) {
            // person_id_2 is me
            const other = personMap.get(rel.person_id_1);
            if (!other) return;
            let type = rel.relation_type;
            if (type === 'parent') type = other.gender === 'male' ? 'Father' : 'Mother'; // other is parent to me
            else if (type === 'spouse') type = other.gender === 'male' ? 'Husband' : 'Wife';
            else if (type === 'sibling') type = other.gender === 'male' ? 'Brother' : 'Sister';
            relatives.push({ ...other, relationToMe: type });
        }
    });

    return relatives;
}

const synthesizePersonLifeEvents = (personDetails) => {
    const events = [];
    if (!personDetails) return events;

    const birth = personDetails.date_of_birth || personDetails.birth_date;
    if (birth) {
        events.push({
            id: `birth-${personDetails.id}`,
            year: new Date(birth).getFullYear(),
            title: 'Born',
            description: personDetails.place_of_birth
                ? `Born in ${personDetails.place_of_birth}`
                : 'Birth event',
            start_date: birth
        });
    }
    if (personDetails.anniversary_date) {
        events.push({
            id: `marriage-${personDetails.id}`,
            year: new Date(personDetails.anniversary_date).getFullYear(),
            title: 'Marriage',
            description: 'Married to spouse',
            start_date: personDetails.anniversary_date
        });
    }
    if (personDetails.death_date && personDetails.is_alive === false) {
        events.push({
            id: `death-${personDetails.id}`,
            year: new Date(personDetails.death_date).getFullYear(),
            title: 'Passed Away',
            description: 'Death event',
            start_date: personDetails.death_date
        });
    }
    return events;
};

const assertSpaceMember = async (userId, spaceId) => {
    if (!spaceId) return true;
    const { data } = await supabase
        .from('family_memberships')
        .select('id')
        .eq('user_id', userId)
        .eq('family_space_id', spaceId)
        .maybeSingle();
    return Boolean(data);
};

/**
 * Get profile for the current user, or another member via person_id / user_id.
 * GET /api/app/profile
 * GET /api/app/profile?person_id=<uuid>
 * GET /api/app/profile?user_id=<uuid>
 * Header: x-family-space-id (required when viewing another member)
 */
export const getProfile = async (req, res) => {
    try {
        const viewerId = req.user.id;
        const spaceId = req.headers['x-family-space-id'] || req.query.family_space_id || null;
        const queryPersonId = (req.query.person_id || '').toString().trim() || null;
        const queryUserId = (req.query.user_id || '').toString().trim() || null;

        let targetUserId = viewerId;
        let targetPersonId = null;
        let personRow = null;
        let isOwnProfile = true;

        if (queryPersonId || queryUserId) {
            if (!spaceId) {
                return res.status(400).json({
                    error: 'family_space_id (header x-family-space-id) is required to view another member'
                });
            }

            const viewerOk = await assertSpaceMember(viewerId, spaceId);
            if (!viewerOk) {
                return res.status(403).json({ error: 'You are not a member of this family space' });
            }

            if (queryPersonId) {
                const { data: person, error: personError } = await supabase
                    .from('persons')
                    .select('*')
                    .eq('id', queryPersonId)
                    .eq('family_space_id', spaceId)
                    .maybeSingle();

                if (personError) throw personError;
                if (!person) {
                    return res.status(404).json({ error: 'Member not found in this family space' });
                }

                personRow = person;
                targetPersonId = person.id;
                targetUserId = person.claimed_by || null;
                isOwnProfile = Boolean(targetUserId && targetUserId === viewerId);
            } else {
                targetUserId = queryUserId;
                isOwnProfile = targetUserId === viewerId;

                const { data: claimed } = await supabase
                    .from('persons')
                    .select('*')
                    .eq('claimed_by', targetUserId)
                    .eq('family_space_id', spaceId)
                    .maybeSingle();

                personRow = claimed || null;
                targetPersonId = claimed?.id || null;

                // Target must belong to this space (membership or claimed person)
                const targetOk = await assertSpaceMember(targetUserId, spaceId);
                if (!targetOk && !personRow) {
                    return res.status(404).json({ error: 'User is not part of this family space' });
                }
            }
        } else if (spaceId) {
            const { data } = await supabase
                .from('persons')
                .select('*')
                .eq('claimed_by', viewerId)
                .eq('family_space_id', spaceId)
                .maybeSingle();
            personRow = data || null;
            targetPersonId = data?.id || null;
        }

        // Privacy for other profiles
        let isProfileLocked = false;
        let visibility = 'family';
        if (!isOwnProfile && targetUserId) {
            const { data: privacy } = await supabase
                .from('user_privacy_settings')
                .select('search_visibility, is_profile_locked')
                .eq('user_id', targetUserId)
                .maybeSingle();
            visibility = privacy?.search_visibility || 'family';
            // Locked only for explicit private / admin-only; family members can view within the space
            isProfileLocked = Boolean(
                privacy?.is_profile_locked
                || visibility === 'private'
                || visibility === 'admin'
            );
        }

        let user = null;
        if (targetUserId) {
            const { data: userRow, error: userError } = await supabase
                .from('users')
                .select(PROFILE_USER_COLUMNS)
                .eq('id', targetUserId)
                .maybeSingle();
            if (userError) throw userError;
            user = userRow;
        }

        const { count: spaceCount } = targetUserId
            ? await supabase
                .from('family_memberships')
                .select('*', { count: 'exact', head: true })
                .eq('user_id', targetUserId)
            : { count: 0 };

        let relatives = [];
        if (targetPersonId && spaceId) {
            relatives = await getRelatives(targetPersonId, spaceId);
        }

        let events = [];
        if (spaceId) {
            const timelineEvents = [];

            if (targetUserId) {
                const { data: userEvents } = await supabase
                    .from('events')
                    .select('*')
                    .eq('family_space_id', spaceId)
                    .eq('creator_id', targetUserId)
                    .order('start_date', { ascending: true });

                for (const e of userEvents || []) {
                    timelineEvents.push({
                        id: e.id,
                        year: e.start_date ? new Date(e.start_date).getFullYear() : 'Unknown',
                        title: e.title,
                        description: e.description,
                        start_date: e.start_date
                    });
                }
            }

            if (personRow) {
                timelineEvents.push(...synthesizePersonLifeEvents(personRow));
            } else if (targetPersonId) {
                const { data: personDetails } = await supabase
                    .from('persons')
                    .select('*')
                    .eq('id', targetPersonId)
                    .maybeSingle();
                timelineEvents.push(...synthesizePersonLifeEvents(personDetails));
            }

            events = timelineEvents.sort((a, b) => {
                if (!a.start_date) return 1;
                if (!b.start_date) return -1;
                return new Date(a.start_date) - new Date(b.start_date);
            });
        }

        // Prefer user profile fields; fall back to tree person for unclaimed members
        const personFullName = personRow
            ? (personRow.full_name
                || `${personRow.first_name || ''} ${personRow.last_name || ''}`.trim()
                || null)
            : null;
        const userFullName = user
            ? (`${user.first_name || ''} ${user.last_name || ''}`.trim() || null)
            : null;
        const fullName = userFullName || personFullName || 'Unknown';

        const dateOfBirth = user?.date_of_birth
            || personRow?.date_of_birth
            || personRow?.birth_date
            || null;
        const placeOfBirth = user?.place_of_birth || personRow?.place_of_birth || null;
        const occupation = user?.occupation || personRow?.occupation || null;
        const bio = user?.bio || personRow?.bio || null;
        const avatarUrl = user?.avatar_url || personRow?.avatar_url || null;
        const companyLinks = user ? pickCompanyLinks(user) : pickCompanyLinks({});

        const hidePrivate = !isOwnProfile && isProfileLocked;

        res.json({
            is_own_profile: isOwnProfile,
            is_profile_locked: isProfileLocked,
            visibility,
            user_id: targetUserId,
            person_id: targetPersonId,
            claimed: Boolean(targetUserId),
            profile: {
                full_name: fullName,
                avatar_url: avatarUrl,
                bio: hidePrivate ? null : bio,
                date_of_birth: hidePrivate ? null : dateOfBirth,
                place_of_birth: hidePrivate ? null : placeOfBirth,
                occupation: hidePrivate ? null : occupation,
                spaces_count: spaceCount || 0,
                ...(hidePrivate ? {} : companyLinks)
            },
            company_links: hidePrivate ? pickCompanyLinks({}) : companyLinks,
            vital_statistics: hidePrivate
                ? null
                : {
                    full_name: fullName,
                    born: dateOfBirth,
                    location: placeOfBirth,
                    occupation,
                    ...companyLinks
                },
            family_members: relatives.map(r => ({
                id: r.id,
                name: r.full_name || `${r.first_name || ''} ${r.last_name || ''}`.trim(),
                relation: r.relationToMe,
                avatar_url: r.avatar_url,
                claimed_by: r.claimed_by || null,
                user_id: r.claimed_by || null
            })),
            key_life_events: hidePrivate ? [] : events
        });
    } catch (err) {
        console.error('[getProfile] Error:', err);
        res.status(500).json({ error: 'Internal server error fetching profile' });
    }
};

/**
 * Update the user's profile
 * PUT /api/app/profile
 */
export const updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { bio, first_name, last_name, date_of_birth, place_of_birth, occupation } = req.body;

        const updates = {
            updated_at: new Date().toISOString(),
            ...extractCompanyLinkUpdates(req.body)
        };
        if (bio !== undefined) updates.bio = bio;
        if (first_name !== undefined) updates.first_name = first_name;
        if (last_name !== undefined) updates.last_name = last_name;
        if (date_of_birth !== undefined) updates.date_of_birth = date_of_birth;
        if (place_of_birth !== undefined) updates.place_of_birth = place_of_birth;
        if (occupation !== undefined) updates.occupation = occupation;

        if (req.file) {
            // Upload to Supabase Storage
            const ext = req.file.originalname.split('.').pop();
            const path = `users/${userId}/avatar_${Date.now()}.${ext}`;
            const publicUrl = await uploadFile(BUCKETS.AVATARS, path, req.file.buffer, req.file.mimetype);
            updates.avatar_url = publicUrl;
        } else if (req.body.avatar_url !== undefined) {
            updates.avatar_url = req.body.avatar_url; // Handle clear avatar or passing URL directly
        }

        const { data, error } = await supabase
            .from('users')
            .update(updates)
            .eq('id', userId)
            .select(PROFILE_USER_COLUMNS)
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: {
                ...data,
                ...pickCompanyLinks(data)
            },
            company_links: pickCompanyLinks(data)
        });

    } catch (err) {
        console.error('[updateProfile] Error:', err);
        res.status(500).json({ error: 'Internal server error updating profile' });
    }
};

/**
 * Get Generation Data (Timeline)
 * GET /api/app/generation
 */
export const getGeneration = async (req, res) => {
    try {
        const spaceId = req.headers['x-family-space-id'];
        if (!spaceId) return res.status(400).json({ error: 'x-family-space-id header is required' });

        // 1. Fetch all persons in the space
        const { data: persons, error: personsErr } = await supabase
            .from('persons')
            .select('*')
            .eq('family_space_id', spaceId);

        if (personsErr) throw personsErr;
        if (!persons || persons.length === 0) {
            return res.json({ rootAncestor: null, stats: { totalMembers: 0, totalGenerations: 0, totalYears: 0 }, generations: [] });
        }

        // 2. Fetch relations
        const personIds = persons.map(p => p.id);
        const { data: relations } = await supabase
            .from('person_relations')
            .select('*')
            .or(`person_id_1.in.(${personIds.join(',')}),person_id_2.in.(${personIds.join(',')})`);

        // Build Graph for generations
        const childrenMap = new Map();
        const parentsMap = new Map();

        persons.forEach(p => {
            childrenMap.set(p.id, []);
            parentsMap.set(p.id, []);
        });

        (relations || []).forEach(rel => {
            if (rel.relation_type === 'parent') {
                // person_id_1 is parent of person_id_2
                if (childrenMap.has(rel.person_id_1)) childrenMap.get(rel.person_id_1).push(rel.person_id_2);
                if (parentsMap.has(rel.person_id_2)) parentsMap.get(rel.person_id_2).push(rel.person_id_1);
            }
        });

        // Find Root Ancestor (person with no parents)
        // If multiple, pick the oldest one by date_of_birth
        let rootAncestor = null;
        const noParents = persons.filter(p => parentsMap.get(p.id).length === 0);
        
        if (noParents.length > 0) {
            rootAncestor = noParents.sort((a, b) => {
                if (!a.date_of_birth) return 1;
                if (!b.date_of_birth) return -1;
                return new Date(a.date_of_birth) - new Date(b.date_of_birth);
            })[0];
        } else {
            rootAncestor = persons[0]; // fallback
        }

        // BFS to determine generation levels
        const generations = {};
        const queue = [{ id: rootAncestor.id, level: 1 }];
        const visited = new Set();

        while (queue.length > 0) {
            const curr = queue.shift();
            if (visited.has(curr.id)) continue;
            visited.add(curr.id);

            if (!generations[curr.level]) generations[curr.level] = [];
            
            const personData = persons.find(p => p.id === curr.id);
            if (personData) {
                generations[curr.level].push({
                    id: personData.id,
                    name: personData.full_name || `${personData.first_name} ${personData.last_name}`.trim(),
                    avatar_url: personData.avatar_url,
                    role: curr.level === 1 ? 'Root Ancestor' : 'Existing Family Member'
                });
            }

            const children = childrenMap.get(curr.id) || [];
            children.forEach(childId => {
                queue.push({ id: childId, level: curr.level + 1 });
            });
        }

        // For isolated nodes that were not reached by BFS
        persons.forEach(p => {
            if (!visited.has(p.id)) {
                if (!generations[1]) generations[1] = [];
                generations[1].push({
                    id: p.id,
                    name: p.full_name || `${p.first_name} ${p.last_name}`.trim(),
                    avatar_url: p.avatar_url,
                    role: 'Unlinked Member'
                });
            }
        });

        // Formatting Output
        const sortedLevels = Object.keys(generations).map(Number).sort((a, b) => a - b);
        const formattedGenerations = sortedLevels.map(lvl => {
            let label = `${lvl}th Generation`;
            if (lvl === 1) label = '1st Generation';
            else if (lvl === 2) label = '2nd Generation';
            else if (lvl === 3) label = '3rd Generation';

            return {
                level: label,
                members: generations[lvl]
            };
        });

        // Calculate total years
        let totalYears = 0;
        if (rootAncestor.date_of_birth) {
            const birthYear = new Date(rootAncestor.date_of_birth).getFullYear();
            const endYear = rootAncestor.death_date ? new Date(rootAncestor.death_date).getFullYear() : new Date().getFullYear();
            totalYears = endYear - birthYear;
        }

        res.json({
            rootAncestor: {
                id: rootAncestor.id,
                name: rootAncestor.full_name || `${rootAncestor.first_name} ${rootAncestor.last_name}`.trim(),
                avatar_url: rootAncestor.avatar_url,
                years: rootAncestor.date_of_birth ? `${new Date(rootAncestor.date_of_birth).getFullYear()}-${rootAncestor.death_date ? new Date(rootAncestor.death_date).getFullYear() : 'Present'}` : 'Unknown'
            },
            stats: {
                totalMembers: persons.length,
                totalGenerations: sortedLevels.length,
                totalYears: totalYears > 0 ? totalYears : 0
            },
            generations: formattedGenerations
        });

    } catch (err) {
        console.error('[getGeneration] Error:', err);
        res.status(500).json({ error: 'Internal server error fetching generation data' });
    }
};

/**
 * Get Current User's Normalized App Role in the Family Space
 * GET /api/app/profile/my-role
 */
export const getMyRole = async (req, res) => {
    try {
        const userId = req.user.id;
        const spaceId = req.headers['x-family-space-id'] || req.query.family_space_id;

        if (!spaceId) {
            return res.status(400).json({ error: 'family_space_id is required' });
        }

        // Fetch user's membership for this space
        const { data: membership, error } = await supabase
            .from('family_memberships')
            .select('role')
            .eq('user_id', userId)
            .eq('family_space_id', spaceId)
            .maybeSingle();

        if (error) throw error;

        // Determine raw role (default to guest if no membership)
        const rawRole = membership?.role || 'guest';
        
        let appRole = 'Guest';
        let permissions = {
            can_edit_tree_directly: false,
            can_manage_members: false,
            can_edit_settings: false,
            can_submit_requests: false,
            is_read_only: true
        };

        // Admins (owner, admin, branch-admin)
        if (['owner', 'admin', 'branch-admin'].includes(rawRole)) {
            appRole = 'Admin';
            permissions = {
                can_edit_tree_directly: true,
                can_manage_members: true,
                can_edit_settings: true,
                can_submit_requests: false, // Admins just do it, they don't request
                is_read_only: false
            };
        } 
        // Members
        else if (rawRole === 'member') {
            appRole = 'Member';
            permissions = {
                can_edit_tree_directly: false,
                can_manage_members: false,
                can_edit_settings: false,
                can_submit_requests: true, // Members submit requests
                is_read_only: false
            };
        }
        // Guests (default state mapped above)

        res.json({
            user_id: userId,
            family_space_id: spaceId,
            raw_role: rawRole,
            app_role: appRole,
            permissions
        });

    } catch (err) {
        console.error('[getMyRole] Error:', err);
        res.status(500).json({ error: 'Internal server error fetching user role' });
    }
};
