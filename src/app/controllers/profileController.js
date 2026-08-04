import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';

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

/**
 * Get the current user's profile with family members and events
 * GET /api/app/profile
 */
export const getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const spaceId = req.headers['x-family-space-id'];

        // 1. Get Base User Info
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('first_name, last_name, avatar_url, bio, date_of_birth, place_of_birth, occupation, gender')
            .eq('id', userId)
            .single();

        if (userError) throw userError;

        // 2. Count memberships
        const { count: spaceCount } = await supabase
            .from('family_memberships')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', userId);

        // 3. Find if user claimed a person in this space
        let relatives = [];
        let claimedPerson = null;
        if (spaceId) {
            const { data } = await supabase
                .from('persons')
                .select('id, full_name')
                .eq('claimed_by', userId)
                .eq('family_space_id', spaceId)
                .maybeSingle();

            claimedPerson = data;

            if (claimedPerson) {
                relatives = await getRelatives(claimedPerson.id, spaceId);
            }
        }

        let events = [];
        if (spaceId) {
            const { data: userEvents } = await supabase
                .from('events')
                .select('*')
                .eq('family_space_id', spaceId)
                .eq('creator_id', userId)
                .order('start_date', { ascending: true });
            
            // Map regular events
            const timelineEvents = (userEvents || []).map(e => ({
                id: e.id,
                year: e.start_date ? new Date(e.start_date).getFullYear() : 'Unknown',
                title: e.title,
                description: e.description,
                start_date: e.start_date
            }));

            // If user claimed a person, synthensize life events
            if (claimedPerson) {
                const { data: personDetails } = await supabase.from('persons').select('*').eq('id', claimedPerson.id).single();
                if (personDetails) {
                    if (personDetails.date_of_birth) {
                        timelineEvents.push({
                            id: `birth-${personDetails.id}`,
                            year: new Date(personDetails.date_of_birth).getFullYear(),
                            title: 'Born',
                            description: personDetails.place_of_birth ? `Born in ${personDetails.place_of_birth}` : 'Birth event',
                            start_date: personDetails.date_of_birth
                        });
                    }
                    if (personDetails.anniversary_date) {
                        timelineEvents.push({
                            id: `marriage-${personDetails.id}`,
                            year: new Date(personDetails.anniversary_date).getFullYear(),
                            title: 'Marriage',
                            description: 'Married to spouse',
                            start_date: personDetails.anniversary_date
                        });
                    }
                    if (personDetails.death_date && !personDetails.is_alive) {
                        timelineEvents.push({
                            id: `death-${personDetails.id}`,
                            year: new Date(personDetails.death_date).getFullYear(),
                            title: 'Passed Away',
                            description: 'Death event',
                            start_date: personDetails.death_date
                        });
                    }
                }
            }

            // Sort merged timeline
            events = timelineEvents.sort((a, b) => {
                if (!a.start_date) return 1;
                if (!b.start_date) return -1;
                return new Date(a.start_date) - new Date(b.start_date);
            });
        }

        const fullName = user.first_name || user.last_name ? `${user.first_name || ''} ${user.last_name || ''}`.trim() : 'Unknown';

        res.json({
            profile: {
                full_name: fullName,
                avatar_url: user.avatar_url,
                bio: user.bio,
                date_of_birth: user.date_of_birth,
                place_of_birth: user.place_of_birth,
                occupation: user.occupation,
                spaces_count: spaceCount || 0
            },
            vital_statistics: {
                full_name: fullName,
                born: user.date_of_birth,
                location: user.place_of_birth,
                occupation: user.occupation
            },
            family_members: relatives.map(r => ({
                id: r.id,
                name: r.full_name || `${r.first_name} ${r.last_name}`.trim(),
                relation: r.relationToMe,
                avatar_url: r.avatar_url
            })),
            key_life_events: events
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

        const updates = { updated_at: new Date().toISOString() };
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
            .select('first_name, last_name, avatar_url, bio, date_of_birth, place_of_birth, occupation')
            .single();

        if (error) throw error;

        res.json({
            success: true,
            message: 'Profile updated successfully',
            profile: data
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
