import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';
import { getGovernancePermissions } from '../../utils/familyGovernancePolicy.js';
import { normalizeFamilyRole } from '../../utils/familyRolePolicy.js';

/**
 * Helper to calculate generation depth by tracing parents recursively.
 */
async function getGenerationDepth(personId, depth = 1) {
    try {
        const { data: rel, error } = await supabase
            .from('person_relations')
            .select('person_id_1')
            .eq('person_id_2', personId)
            .eq('relation_type', 'parent')
            .limit(1)
            .maybeSingle();

        if (error) return depth;
        if (rel && rel.person_id_1) {
            if (depth > 20) return depth;
            return getGenerationDepth(rel.person_id_1, depth + 1);
        }
        return depth;
    } catch (err) {
        return depth;
    }
}

/**
 * Upload a photo for a member (or a temporary one during Add Member flow).
 */
export const uploadMemberPhoto = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        
        const { memberId } = req.body;
        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const path = `members/${memberId || 'temp'}-${Date.now()}.${ext}`;

        const publicUrl = await uploadFile(BUCKETS.AVATARS, path, req.file.buffer, req.file.mimetype);

        if (memberId && memberId !== 'undefined') {
            await supabase.from('persons').update({ avatar_url: publicUrl }).eq('id', memberId);
        }

        res.json({ url: publicUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get dashboard statistics for a specific branch.
 */
export const getBranchDashboardStats = async (req, res) => {
    try {
        const { branchId } = req.params;
        let { familySpaceId } = req.query;

        if (!familySpaceId || familySpaceId === 'undefined') {
            const { data: firstFam } = await supabase.from('family_spaces').select('id').limit(1).maybeSingle();
            familySpaceId = firstFam?.id;
        }

        if (!branchId) return res.status(400).json({ error: 'Branch ID is required' });

        const { count: memberCount } = await supabase
            .from('persons')
            .select('*', { count: 'exact', head: true })
            .eq('branch_id', branchId);

        const { count: pendingApprovals } = await supabase
            .from('claims')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending');

        const { data: branch } = await supabase.from('family_branches').select('name, family_space_id').eq('id', branchId).single();

        const { count: upcomingEvents } = await supabase
            .from('events')
            .select('*', { count: 'exact', head: true })
            .eq('branch_name', branch?.name)
            .gte('start_date', new Date().toISOString());

        const { data: locations } = await supabase.from('persons').select('birth_place, death_place').eq('branch_id', branchId);
        const uniqueLocs = new Set();
        locations?.forEach(l => {
            if (l.birth_place) uniqueLocs.add(l.birth_place);
            if (l.death_place) uniqueLocs.add(l.death_place);
        });

        res.json({
            stats: {
                members: memberCount || 0,
                households: Math.ceil((memberCount || 0) / 3),
                generations: 1,
                migration_nodes: uniqueLocs.size,
                history_chapters: 'Pending',
                media_assets: 'Pending',
                pending_approvals: pendingApprovals || 0,
                upcoming_events: upcomingEvents || 0
            },
            branch_info: {
                id: branchId,
                name: branch?.name || 'Unknown Branch',
                family_space_id: branch?.family_space_id,
                display_id: `#${(branch?.name || 'BRN').slice(0, 3).toUpperCase()}-${branchId.slice(-4)}`
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get branch members with details for the dashboard tree/list.
 */
export const getBranchMembers = async (req, res) => {
    try {
        const { branchId } = req.params;
        const { data: branch } = await supabase.from('family_branches').select('family_space_id, branch_admin_id, root_person_id, head_person_id').eq('id', branchId).single();
        const familySpaceId = branch?.family_space_id;

        const targetPersonIds = [branch?.root_person_id, branch?.head_person_id].filter(Boolean);
        if (targetPersonIds.length > 0) {
            await supabase.from('persons').update({ branch_id: branchId }).in('id', targetPersonIds);
        }

        let filterQuery = `branch_id.eq.${branchId}`;
        if (targetPersonIds.length > 0) {
            filterQuery = `${filterQuery},id.in.(${targetPersonIds.join(',')})`;
        }

        const { data: members, error } = await supabase
            .from('persons')
            .select('*, claimed_by_user:claimed_by(id, first_name, last_name, avatar_url)')
            .or(filterQuery)
            .eq('status', 'active')
            .order('full_name', { ascending: true });

        if (error) throw error;

        const enriched = await Promise.all((members || []).map(async (m) => {
            let role = 'Member';
            
            // 1. Check if this member is the Branch Admin themselves
            if (branch.branch_admin_id && m.claimed_by === branch.branch_admin_id) {
                role = 'Branch Admin';
            } else if (branch.root_person_id && m.id === branch.root_person_id) {
                role = 'Root Ancestor';
            } else if (branch.head_person_id && m.id === branch.head_person_id) {
                role = 'Branch Head';
            } 
            // 2. Check if the member is claimed by a user and find their family space role
            else if (m.claimed_by && familySpaceId) {
                const { data: membership } = await supabase
                    .from('family_memberships')
                    .select('role')
                    .eq('user_id', m.claimed_by)
                    .eq('family_space_id', familySpaceId)
                    .maybeSingle();
                
                if (membership && membership.role) {
                    role = membership.role.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                } else {
                    role = 'User';
                }
            }
            // 3. Default to 'Member' if not claimed
            else {
                role = 'Family Member';
            }

            const { data: rel } = await supabase
                .from('person_relations')
                .select('relation_type')
                .eq('person_id_2', m.id)
                .limit(1)
                .maybeSingle();
            
            let relation = 'Branch Member';
            if (rel) {
                if (rel.relation_type === 'parent') relation = 'Child';
                else if (rel.relation_type === 'spouse') relation = 'Spouse';
                else relation = rel.relation_type.charAt(0).toUpperCase() + rel.relation_type.slice(1);
            }

            const genNum = await getGenerationDepth(m.id);
            const { count: childCount } = await supabase.from('person_relations').select('*', { count: 'exact', head: true }).eq('person_id_1', m.id).eq('relation_type', 'parent');
            
            return {
                id: m.id,
                name: m.full_name,
                dob: m.birth_date ? new Date(m.birth_date).getFullYear().toString() : '-',
                dod: m.death_date ? new Date(m.death_date).getFullYear().toString() : null,
                gender: m.gender || 'Other',
                location: m.birth_place || '-',
                childrenCount: childCount || 0,
                avatar: m.avatar_url,
                generation: `G${genNum}`,
                relation: relation,
                role: role,
                userId: m.claimed_by,
                status: m.death_date ? 'Deceased' : 'Active'
            };
        }));
        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get a single branch member by ID with full lineage and children.
 */
export const getBranchMemberById = async (req, res) => {
    try {
        const { memberId } = req.params;
        const { data: member, error } = await supabase
            .from('persons')
            .select('*, claimed_by_user:claimed_by(id, first_name, last_name, avatar_url)')
            .eq('id', memberId)
            .single();

        if (error) throw error;

        const { data: branch } = await supabase.from('family_branches').select('family_space_id').eq('id', member.branch_id).single();
        const familySpaceId = branch?.family_space_id;

        let role = 'Member';
        if (member.claimed_by && familySpaceId) {
            const { data: membership } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('user_id', member.claimed_by)
                .eq('family_space_id', familySpaceId)
                .maybeSingle();
            if (membership) {
                role = membership.role.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
            }
        }

        // Fetch Parents
        const { data: parents } = await supabase
            .from('person_relations')
            .select('person_id_1, persons!person_relations_person_id_1_fkey(full_name, gender)')
            .eq('person_id_2', member.id)
            .eq('relation_type', 'parent');
        
        const father = parents?.find(p => p.persons.gender?.toLowerCase() === 'male');
        const mother = parents?.find(p => p.persons.gender?.toLowerCase() === 'female');

        // Fetch Spouse
        const { data: spouseRel } = await supabase
            .from('person_relations')
            .select('person_id_1, person_id_2, persons!person_relations_person_id_2_fkey(full_name), p2:persons!person_relations_person_id_1_fkey(full_name)')
            .or(`person_id_1.eq.${member.id},person_id_2.eq.${member.id}`)
            .eq('relation_type', 'spouse')
            .limit(1)
            .maybeSingle();

        let spouse = null;
        if (spouseRel) {
            if (spouseRel.person_id_1 === member.id) {
                spouse = { id: spouseRel.person_id_2, name: spouseRel.persons.full_name };
            } else {
                spouse = { id: spouseRel.person_id_1, name: spouseRel.p2.full_name };
            }
        }

        // Fetch Children
        const { data: childrenRels } = await supabase
            .from('person_relations')
            .select('person_id_2, persons!person_relations_person_id_2_fkey(full_name)')
            .eq('person_id_1', member.id)
            .eq('relation_type', 'parent');
        
        const children = (childrenRels || []).map(c => ({ id: c.person_id_2, name: c.persons.full_name }));

        const genNum = await getGenerationDepth(member.id);

        const enriched = {
            id: member.id,
            name: member.full_name,
            chineseName: member.chinese_name,
            dob: member.birth_date ? new Date(member.birth_date).getFullYear().toString() : '-',
            dod: member.death_date ? new Date(member.death_date).getFullYear().toString() : null,
            gender: member.gender || 'Other',
            location: member.birth_place || '-',
            childrenCount: children.length,
            avatar: member.avatar_url,
            generation: `G${genNum}`,
            role: role,
            status: member.death_date ? 'Deceased' : 'Active',
            bio: member.bio,
            email: member.email,
            father: father ? { id: father.person_id_1, name: father.persons.full_name } : null,
            mother: mother ? { id: mother.person_id_1, name: mother.persons.full_name } : null,
            spouse: spouse,
            children: children
        };

        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Search for persons within a family space.
 */
export const searchPersons = async (req, res) => {
    try {
        const { query, branchId } = req.query;
        if (!query) return res.json([]);

        let familySpaceId;
        if (branchId) {
            const { data: branch } = await supabase.from('family_branches').select('family_space_id').eq('id', branchId).single();
            familySpaceId = branch?.family_space_id;
        }

        if (!familySpaceId) {
             const { data: firstFam } = await supabase.from('family_spaces').select('id').limit(1).maybeSingle();
             familySpaceId = firstFam?.id;
        }

        const { data: persons, error } = await supabase
            .from('persons')
            .select('id, full_name, avatar_url, birth_date, gender')
            .ilike('full_name', `%${query}%`)
            .limit(10);

        if (error) throw error;

        res.json(persons.map(p => ({
            id: p.id,
            name: p.full_name,
            avatar: p.avatar_url,
            birthDate: p.birth_date,
            gender: p.gender
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Add a new member to the branch.
 */
export const addBranchMember = async (req, res) => {
    try {
        const { branchId } = req.params;
        const { fullName, chineseName, birthDate, deathDate, gender, bio, privacyMode, fatherId, motherId, spouseId, personId, targetPersonId, relationshipType, avatarUrl } = req.body;
        const { data: branch } = await supabase.from('family_branches').select('family_space_id').eq('id', branchId).single();
        
        let person;
        if (personId) {
            const { data, error } = await supabase.from('persons').update({ branch_id: branchId }).eq('id', personId).select().single();
            if (error) throw error;
            person = data;
        } else {
            const { data: tree } = await supabase.from('clan_trees').select('id').eq('family_space_id', branch.family_space_id).limit(1).single();
            const { data, error } = await supabase.from('persons').insert({
                clan_tree_id: tree?.id,
                full_name: fullName,
                chinese_name: chineseName,
                birth_date: birthDate || null,
                death_date: deathDate || null,
                gender: gender?.toLowerCase(),
                bio,
                privacy_mode: privacyMode || 'private',
                branch_id: branchId,
                status: 'active',
                avatar_url: avatarUrl || null
            }).select().single();
            if (error) throw error;
            person = data;
        }

        const relations = [];
        if (fatherId) relations.push({ person_id_1: fatherId, person_id_2: person.id, relation_type: 'parent' });
        if (motherId) relations.push({ person_id_1: motherId, person_id_2: person.id, relation_type: 'parent' });
        if (spouseId) relations.push({ person_id_1: person.id, person_id_2: spouseId, relation_type: 'spouse' });
        if (targetPersonId && relationshipType) {
             const type = relationshipType.toLowerCase();
             if (type === 'child') relations.push({ person_id_1: targetPersonId, person_id_2: person.id, relation_type: 'parent' });
             else if (type === 'parent') relations.push({ person_id_1: person.id, person_id_2: targetPersonId, relation_type: 'parent' });
             else if (type === 'spouse') relations.push({ person_id_1: person.id, person_id_2: targetPersonId, relation_type: 'spouse' });
        }
        
        if (relations.length > 0) {
            const { data: tree } = await supabase.from('clan_trees').select('id').eq('family_space_id', branch.family_space_id).limit(1).single();
            const enriched = relations.map(r => ({ ...r, clan_tree_id: tree.id }));
            await supabase.from('person_relations').insert(enriched);
        }

        await logActivity(req.user?.id, 'ADD_BRANCH_MEMBER', 'persons', person.id, branch.family_space_id);
        res.status(201).json(person);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update a branch member and their relations.
 */
export const updateBranchMember = async (req, res) => {
    try {
        const { memberId } = req.params;
        const { fullName, chineseName, birthDate, deathDate, gender, bio, email, phone, fatherId, motherId, spouseId, childrenIds, avatarUrl } = req.body;
        
        // 1. Fetch current data for comparison and existence check
        const { data: person } = await supabase.from('persons').select('*').eq('id', memberId).single();

        const updateData = {
            full_name: fullName,
            chinese_name: chineseName,
            birth_date: birthDate || null,
            death_date: deathDate || null,
            gender: gender?.toLowerCase(),
            bio,
            email
        };

        if (avatarUrl) updateData.avatar_url = avatarUrl;

        // DYNAMIC BRANCH-SCOPED APPROVAL LOGIC
        // If this is a member edit, we create a PENDING REQUEST (Claims for self-edit, branch_edit_requests for admin edit)
        const isSelfEdit = req.user?.id === person?.claimed_by; 
        
        if (isSelfEdit) {
            const { data: request, error: reqError } = await supabase.from('claims').insert({
                user_id: req.user.id,
                person_id: memberId,
                type: 'edit',
                status: 'pending',
                details: {
                    before: { fullName: person?.full_name, bio: person?.bio },
                    after: { fullName, chineseName, birthDate, deathDate, gender, bio, email }
                }
            }).select().single();
            
            if (reqError) throw reqError;

            try {
                const { data: branch } = await supabase
                    .from('family_branches')
                    .select('family_space_id')
                    .eq('id', person.branch_id)
                    .maybeSingle();
                if (branch?.family_space_id) {
                    const { dispatchNotification } = await import('../../services/notificationService.js');
                    dispatchNotification(
                        branch.family_space_id,
                        'Claim request',
                        'New claim request',
                        'A member submitted a lineage edit claim for approval.',
                        undefined,
                        { channel: 'claims' }
                    ).catch(() => {});
                }
            } catch (_) { /* non-blocking */ }

            return res.json({ message: 'Edit request submitted for branch approval', request });
        } else {
            // Branch Admin editing another member -> submit to Family Owner for approval
            const { data: branch } = await supabase.from('family_branches').select('family_space_id').eq('id', person.branch_id).single();
            const { data: reqData, error: reqError } = await supabase
                .from('branch_edit_requests')
                .insert({
                    family_space_id: branch.family_space_id,
                    branch_id: person.branch_id,
                    requested_by: req.user?.id,
                    request_type: 'edit_member',
                    current_value: person,
                    proposed_value: { ...person, ...updateData, fatherId, motherId, spouseId, childrenIds },
                    reason: 'Admin modifying member profile',
                    status: 'pending'
                })
                .select()
                .single();

            if (reqError) throw reqError;
            return res.status(202).json({ message: 'Member update request submitted for family admin approval.', request: reqData });
        }

        const { data: updatedPerson, error } = await supabase.from('persons').update(updateData).eq('id', memberId).select().single();

        if (error) throw error;

        const { data: branch } = await supabase.from('family_branches').select('family_space_id').eq('id', person.branch_id).single();
        const { data: tree } = await supabase.from('clan_trees').select('id').eq('family_space_id', branch.family_space_id).limit(1).single();

        // Update Parent Relations
        if (fatherId !== undefined || motherId !== undefined) {
            await supabase.from('person_relations').delete().eq('person_id_2', memberId).eq('relation_type', 'parent');
            const newParents = [];
            if (fatherId) newParents.push({ person_id_1: fatherId, person_id_2: memberId, relation_type: 'parent', clan_tree_id: tree.id });
            if (motherId) newParents.push({ person_id_1: motherId, person_id_2: memberId, relation_type: 'parent', clan_tree_id: tree.id });
            if (newParents.length > 0) await supabase.from('person_relations').insert(newParents);
        }

        // Update Spouse Relations
        if (spouseId !== undefined) {
            await supabase.from('person_relations').delete().or(`person_id_1.eq.${memberId},person_id_2.eq.${memberId}`).eq('relation_type', 'spouse');
            if (spouseId) {
                await supabase.from('person_relations').insert({ person_id_1: memberId, person_id_2: spouseId, relation_type: 'spouse', clan_tree_id: tree.id });
            }
        }

        // Update Children Relations
        if (childrenIds !== undefined) {
            await supabase.from('person_relations').delete().eq('person_id_1', memberId).eq('relation_type', 'parent');
            if (childrenIds.length > 0) {
                const newChildren = childrenIds.map(cid => ({ person_id_1: memberId, person_id_2: cid, relation_type: 'parent', clan_tree_id: tree.id }));
                await supabase.from('person_relations').insert(newChildren);
            }
        }

        res.json(person);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete (soft-delete) a branch member.
 */
export const deleteBranchMember = async (req, res) => {
    try {
        const { memberId } = req.params;
        const { error } = await supabase.from('persons').update({ status: 'deleted' }).eq('id', memberId);
        if (error) throw error;
        res.json({ message: 'Member deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get events for a branch.
 */
export const getBranchEvents = async (req, res) => {
    try {
        const { branchId } = req.params;
        console.log('>>> [FETCH_BRANCH_EVENTS] BranchId:', branchId);
        const { data: branch } = await supabase.from('family_branches').select('name, family_space_id, family_spaces(name)').eq('id', branchId).single();
        console.log('>>> [FETCH_BRANCH_EVENTS] Branch Name:', branch?.name);
        
        // Fetch events with RSVP counts, attendee avatars, and organizer name
        const { data: events, error } = await supabase
            .from('events')
            .select(`
                *,
                rsvps:event_rsvps(status, user_id, users(avatar_url, first_name, last_name))
            `)
            .eq('branch_name', branch?.name)
            .order('start_date', { ascending: true });

        if (error) {
            console.error('>>> [FETCH_EVENTS_DB_ERROR]', error);
            throw error;
        }

        console.log(`>>> [FETCH_BRANCH_EVENTS] Found ${events?.length} events`);

        // Enrich events with counts
        const enriched = await Promise.all(events.map(async ev => {
            // AUTO-FIX for demo events: If creator_id is null and it's a demo event, assign current user
            if (!ev.creator_id && ev.title?.toLowerCase().includes('demo')) {
                await supabase.from('events').update({ creator_id: req.user?.id }).eq('id', ev.id);
                ev.creator_id = req.user?.id;
                console.log(`>>> [AUTO_FIX] Assigned creator_id to event: ${ev.title}`);
            }

            const going = ev.rsvps?.filter(r => {
                const s = r.status?.toLowerCase();
                return s === 'attending' || s === 'going' || s === 'accepted';
            }) || [];
            
            const userRSVP = ev.rsvps?.find(r => r.user_id === req.user?.id)?.status || 'Join Now';
            
            console.log(`>>> [EVENT_${ev.title}] Going Count: ${going.length}, User RSVP: ${userRSVP}`);
            
            // --- FULLY DYNAMIC IDENTITY RESOLUTION ---
            const branchName = branch?.name || 'Branch';
            let organizerName = branchName;
            let organizerEmail = '-';
            let organizerPhone = '-';

            // 1. Try to resolve the specific person who created this event
            if (ev.creator_id) {
                // Check Users Table first (for account holders)
                const { data: userCreator } = await supabase.from('users').select('first_name, last_name, username, email, phone').eq('id', ev.creator_id).maybeSingle();
                
                if (userCreator) {
                    organizerName = userCreator.first_name ? `${userCreator.first_name} ${userCreator.last_name || ''}`.trim() : (userCreator.username || userCreator.email?.split('@')[0]);
                    organizerEmail = userCreator.email || '-';
                    organizerPhone = userCreator.phone || '-';
                } else {
                    // Check Persons Table (for lineage members or unclaimed profiles)
                    const { data: personCreator } = await supabase.from('persons').select('full_name, contact_email, phone_number').or(`id.eq.${ev.creator_id},claimed_by.eq.${ev.creator_id}`).maybeSingle();
                    if (personCreator) {
                        organizerName = personCreator.full_name;
                        organizerEmail = personCreator.contact_email || '-';
                        organizerPhone = personCreator.phone_number || '-';
                    }
                }
            }

            // 2. If organizer is still generic, try to find the official Branch Leader as a contextual fallback
            if (organizerName === branchName || organizerName === 'Branch') {
                const { data: branchLeader } = await supabase.from('persons').select('full_name, contact_email, phone_number').eq('branch_id', branchId).eq('role', 'Branch Leader').maybeSingle();
                if (branchLeader) {
                    organizerName = branchLeader.full_name;
                    organizerEmail = branchLeader.contact_email || '-';
                    organizerPhone = branchLeader.phone_number || '-';
                }
            } else {
                // If no creator_id, it's a generic branch/family event
                organizerName = branchName;
            }
            
            return {
                ...ev,
                going_count: going.length,
                attendees: going.map(r => r.users?.avatar_url).filter(Boolean).slice(0, 5),
                organizer_name: organizerName,
                organizer_email: organizerEmail,
                organizer_phone: organizerPhone,
                user_rsvp_status: userRSVP
            };
        }));

        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update RSVP status for an event.
 */
export const updateEventRSVP = async (req, res) => {
    try {
        const { eventId } = req.params;
        const { status } = req.body; // attending, going, maybe, no, etc.
        const userId = req.user?.id;

        console.log('>>> [UPDATE_RSVP] Event:', eventId, 'User:', userId, 'Status:', status);

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        // Upsert RSVP
        const { data, error } = await supabase
            .from('event_rsvps')
            .upsert({
                event_id: eventId,
                user_id: userId,
                status: status.toLowerCase(),
                responded_at: new Date().toISOString()
            }, { onConflict: 'event_id, user_id' })
            .select()
            .single();

        if (error) {
            console.error('>>> [UPDATE_RSVP_ERROR]', error);
            throw error;
        }
        res.json({ message: 'RSVP updated successfully', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Upload Event Photo → Supabase Storage
 */
export const uploadEventPhoto = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const path = `events/cover-${Date.now()}.${ext}`;
        const publicUrl = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype);
        res.json({ url: publicUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create an event for a branch.
 */
export const createBranchEvent = async (req, res) => {
    try {
        const { branchId } = req.params;
        const { title, description, startDate, endDate, location, coverUrl, invitedMembers } = req.body;
        const { data: branch } = await supabase.from('family_branches').select('name, family_space_id').eq('id', branchId).single();

        if (branch?.family_space_id && req.user?.id) {
            const perms = await getGovernancePermissions(branch.family_space_id);
            const { data: membership } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('family_space_id', branch.family_space_id)
                .eq('user_id', req.user.id)
                .maybeSingle();
            const role = normalizeFamilyRole(membership?.role);
            if (role === 'branch-admin' && perms.moderateMedia === false) {
                return res.status(403).json({
                    error: 'Branch media/event moderation is disabled by Owner Governance policy.'
                });
            }
        }
        
        const { data: event, error } = await supabase.from('events').insert({
            family_space_id: branch.family_space_id,
            creator_id: req.user?.id,
            title,
            description,
            start_date: startDate,
            end_date: endDate,
            location,
            branch_name: branch.name,
            status: 'upcoming',
            cover_image: coverUrl || null,
            event_time: req.body.eventTime || null
        }).select().single();

        if (error) throw error;

        // If members were invited, create RSVP records (ONLY for members who have a user account)
        if (invitedMembers && invitedMembers.length > 0) {
            const rsvps = invitedMembers
                .filter(id => id && id.length > 0) // Basic check
                .map(memberId => ({
                    event_id: event.id,
                    user_id: memberId,
                    status: 'pending'
                }));
            
            if (rsvps.length > 0) {
                await supabase.from('event_rsvps').insert(rsvps);
            }
        }

        res.status(201).json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get pending approvals for a branch.
 */
export const getBranchApprovals = async (req, res) => {
    try {
        const { branchId } = req.params;
        
        // 1. Fetch claims (existing logic)
        const { data: claimsData, error: claimsError } = await supabase
            .from('claims')
            .select(`
                *,
                user:user_id(first_name, last_name, avatar_url),
                person:person_id(full_name, branch_id)
            `);
            
        // 2. Fetch branch edit requests (new logic)
        const { data: editReqs, error: reqsError } = await supabase
            .from('branch_edit_requests')
            .select(`
                *,
                user:requested_by(first_name, last_name, avatar_url),
                branch:branch_id(name)
            `)
            .eq('branch_id', branchId);

        // Filter claims manually to ensure person(branch_id) match
        const filteredClaims = (claimsData || []).filter(app => app.person?.branch_id === branchId);

        if (claimsError) throw claimsError;
        if (reqsError) throw reqsError;

        // Unify the response format
        const unified = [
            ...filteredClaims.map(app => ({
                id: app.id,
                type: 'Claim',
                item_name: app.person?.full_name || 'Unknown Person',
                requested_by: `${app.user?.first_name || ''} ${app.user?.last_name || ''}`.trim(),
                created_at: app.created_at,
                description: 'Profile Claim Request',
                before: 'Unclaimed Node',
                after: 'Claimed by ' + (app.user?.first_name || 'User'),
                status: app.status,
                source: 'claims'
            })),
            ...(editReqs || []).map(req => {
                let description = 'Branch details update';
                let before = req.current_value?.name || 'Branch';
                let after = req.proposed_value?.name || 'Branch';
                
                // If this is a member edit request
                if (req.request_type === 'edit_member') {
                    description = 'Member Profile Update';
                    before = req.current_value?.full_name || 'Member';
                    after = req.proposed_value?.full_name || 'Member';
                }

                return {
                    id: req.id,
                    type: 'Edit',
                    item_name: req.branch?.name || 'Branch',
                    requested_by: `${req.user?.first_name || ''} ${req.user?.last_name || ''}`.trim(),
                    created_at: req.created_at,
                    description,
                    before,
                    after,
                    status: req.status,
                    source: 'branch_edit_requests'
                };
            })
        ];

        // Sort by newest first
        unified.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json(unified);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Action on approval (Approve/Reject).
 */
export const handleApprovalAction = async (req, res) => {
    try {
        const { approvalId } = req.params;
        const { action } = req.body; 
        const { data: claim, error: cError } = await supabase.from('claims').update({ status: action }).eq('id', approvalId).select().single();
        if (cError) throw cError;

        if (action === 'approved') {
            const { data: personData } = await supabase.from('persons')
                .update({ claimed_by: claim.user_id, member_status: 'active_user' })
                .eq('id', claim.person_id)
                .select('pending_role')
                .single();

            if (personData?.pending_role) {
                await supabase.from('family_memberships').upsert({
                    user_id: claim.user_id,
                    family_space_id: claim.family_space_id,
                    role: personData.pending_role,
                    status: 'active'
                }, { onConflict: 'user_id, family_space_id' });
                await supabase.from('persons').update({ pending_role: null }).eq('id', claim.person_id);
            } else {
                await supabase.from('family_memberships').upsert({
                    user_id: claim.user_id,
                    family_space_id: claim.family_space_id,
                    role: 'member',
                    status: 'active'
                }, { onConflict: 'user_id, family_space_id' });
            }
        }

        res.json({ message: `Claim ${action} successfully` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
