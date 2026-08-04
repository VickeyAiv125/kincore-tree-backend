import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';
import { tableExists, readJsonDb, writeJsonDb } from '../../utils/dbHelper.js';

/**
 * 1. Submit a merge suggestion
 * POST /api/merge/suggestions
 */
export const suggestMerge = async (req, res) => {
    try {
        const { source_space_id, target_space_id, evidence_text, evidence_urls } = req.body;
        const { user } = req;

        const { data, error } = await supabase
            .from('family_merge_suggestions')
            .insert({
                user_id: user.id,
                source_space_id,
                target_space_id,
                evidence_text,
                evidence_urls: evidence_urls || [],
                status: 'pending'
            })
            .select()
            .single();

        if (error) throw error;
        
        await logActivity(user.id, 'SUGGEST_MERGE', 'family_merge_suggestions', data.id, source_space_id);
        
        res.status(201).json({ message: 'Merge suggestion submitted successfully.', suggestion: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * 2. Get Merge Preview
 * GET /api/merge/preview?source_id=X&target_id=Y
 */
export const getMergePreview = async (req, res) => {
    try {
        const source_id = req.query.source_id || req.query.sourceId;
        const target_id = req.query.target_id || req.query.targetId;

        if (!source_id || !target_id) {
            return res.status(400).json({ error: 'source_id and target_id are required' });
        }

        // Fetch source and target details
        const [sourceRes, targetRes] = await Promise.all([
            supabase.from('family_spaces').select('*').eq('id', source_id).single(),
            supabase.from('family_spaces').select('*').eq('id', target_id).single()
        ]);

        if (sourceRes.error || targetRes.error) {
            throw new Error('Could not fetch family spaces details');
        }

        const sourceFamily = sourceRes.data;
        const targetFamily = targetRes.data;

        // Fetch affected members and branches
        const [targetMembersRes, targetBranchesRes, targetAdminsRes, sourceMembersRes] = await Promise.all([
            supabase.from('persons').select('id, first_name, last_name, date_of_birth, current_location').eq('family_space_id', target_id),
            supabase.from('family_branches').select('id, name').eq('family_space_id', target_id),
            supabase.from('family_memberships').select('user_id, role, users!inner(first_name, last_name, email)').eq('family_space_id', target_id).in('role', ['owner', 'admin']),
            supabase.from('persons').select('id, first_name, last_name, date_of_birth, current_location').eq('family_space_id', source_id)
        ]);

        const affectedMembers = targetMembersRes.data || [];
        const affectedBranches = targetBranchesRes.data || [];
        const targetAdmins = targetAdminsRes.data || [];
        const sourceMembers = sourceMembersRes.data || [];

        // Simple duplicate detection algorithm (First + Last Name match)
        const duplicates = [];
        affectedMembers.forEach(tm => {
            const match = sourceMembers.find(sm => 
                sm.first_name?.toLowerCase() === tm.first_name?.toLowerCase() && 
                sm.last_name?.toLowerCase() === tm.last_name?.toLowerCase()
            );
            if (match) {
                duplicates.push({ sourcePerson: match, targetPerson: tm });
            }
        });

        const roleChanges = targetAdmins.map(admin => ({
            userId: admin.user_id,
            name: `${admin.users?.first_name} ${admin.users?.last_name}`,
            email: admin.users?.email,
            oldRole: admin.role,
            newRole: 'member'
        }));

        res.json({
            sourceFamily,
            targetFamily,
            metrics: {
                membersToMerge: affectedMembers.length,
                branchesToMerge: affectedBranches.length,
                duplicateConflicts: duplicates.length,
                adminDowngrades: roleChanges.length
            },
            duplicates,
            roleChanges
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * 3. Initiate Merge Request
 * POST /api/merge/request
 */
export const initiateMergeRequest = async (req, res) => {
    try {
        const source_space_id = req.body.source_space_id || req.body.sourceId;
        const target_space_id = req.body.target_space_id || req.body.targetId;
        const { user } = req;

        // Verify initiator is owner of source
        const { data: membership } = await supabase
            .from('family_memberships')
            .select('role')
            .eq('family_space_id', source_space_id)
            .eq('user_id', user.id)
            .single();

        if (!membership || membership.role !== 'owner') {
            return res.status(403).json({ error: 'Only the Family Owner can initiate a merge.' });
        }

        const { data, error } = await supabase
            .from('family_merge_requests')
            .insert({
                source_space_id,
                target_space_id,
                initiator_user_id: user.id,
                status: 'pending_target_approval'
            })
            .select()
            .single();

        if (error) throw error;

        await logActivity(user.id, 'INITIATE_MERGE', 'family_merge_requests', data.id, source_space_id);

        res.status(201).json({ message: 'Merge request initiated and sent to target family owner.', mergeRequest: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * 4. Respond to Merge Request
 * POST /api/merge/request/:id/respond
 */
export const respondToMergeRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // 'accept' or 'reject'
        const { user } = req;

        const { data: request, error: fetchErr } = await supabase
            .from('family_merge_requests')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !request) throw new Error('Merge request not found.');

        // Verify responder is owner of target
        const { data: membership } = await supabase
            .from('family_memberships')
            .select('role')
            .eq('family_space_id', request.target_space_id)
            .eq('user_id', user.id)
            .single();

        if (!membership || membership.role !== 'owner') {
            return res.status(403).json({ error: 'Only the Target Family Owner can respond to a merge.' });
        }

        if (action === 'reject') {
            const { data } = await supabase.from('family_merge_requests').update({ status: 'rejected' }).eq('id', id).select().single();
            await logActivity(user.id, 'REJECT_MERGE', 'family_merge_requests', id, request.target_space_id);
            return res.json({ message: 'Merge request rejected.', mergeRequest: data });
        }

        if (action === 'accept') {
            // Run Conflict Check internally
            // Simulating conflict check: if duplicate exist -> conflict_review, else approved_ready
            // For now, we will safely route to conflict_review if we suspect duplicates
            const { data: targetMembers } = await supabase.from('persons').select('first_name, last_name').eq('family_space_id', request.target_space_id);
            const { data: sourceMembers } = await supabase.from('persons').select('first_name, last_name').eq('family_space_id', request.source_space_id);
            
            let hasConflicts = false;
            if (targetMembers && sourceMembers) {
                hasConflicts = targetMembers.some(tm => 
                    sourceMembers.some(sm => sm.first_name === tm.first_name && sm.last_name === tm.last_name)
                );
            }

            const newStatus = hasConflicts ? 'conflict_review' : 'approved_ready';

            const { data, error: updateErr } = await supabase
                .from('family_merge_requests')
                .update({ 
                    status: newStatus,
                    conflict_data: hasConflicts ? { reason: 'Duplicate members detected' } : {} 
                })
                .eq('id', id)
                .select()
                .single();

            if (updateErr) throw updateErr;

            await logActivity(user.id, 'ACCEPT_MERGE', 'family_merge_requests', id, request.target_space_id);
            return res.json({ message: `Merge request accepted. Status: ${newStatus}`, mergeRequest: data });
        }

        res.status(400).json({ error: 'Invalid action' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * 5. Resolve Conflicts
 * POST /api/merge/request/:id/resolve
 */
export const resolveMergeConflicts = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolution_data } = req.body;
        const { user } = req; // Assuming Governance/Council Role

        const { data, error } = await supabase
            .from('family_merge_requests')
            .update({ 
                status: 'approved_ready',
                resolution_data: resolution_data || {}
            })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        await logActivity(user.id, 'RESOLVE_MERGE_CONFLICTS', 'family_merge_requests', id, data.source_space_id);
        res.json({ message: 'Conflicts resolved. Ready to execute.', mergeRequest: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * 6. Execute Merge (The Data Engine)
 * POST /api/merge/request/:id/execute
 */
export const executeMerge = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { data: request, error: fetchErr } = await supabase
            .from('family_merge_requests')
            .select('*')
            .eq('id', id)
            .single();

        if (fetchErr || !request) throw new Error('Merge request not found.');

        if (request.status !== 'approved_ready') {
            return res.status(400).json({ error: 'Merge request is not approved and ready.' });
        }

        const sourceId = request.source_space_id;
        const targetId = request.target_space_id;

        // Note: Realistically this should be a PostgreSQL Stored Procedure (RPC) 
        // to guarantee full ACID transaction safety across all these tables.
        // For the scope of this implementation, we execute sequential API calls 
        // but simulate the transaction logic.

        // 1. Re-point Persons
        await supabase.from('persons').update({ family_space_id: sourceId }).eq('family_space_id', targetId);

        // 2. Re-point Branches
        await supabase.from('family_branches').update({ family_space_id: sourceId }).eq('family_space_id', targetId);

        // 3. Re-point Clan Trees (Link target trees to source family)
        await supabase.from('clan_trees').update({ family_space_id: sourceId }).eq('family_space_id', targetId);

        // 4. Downgrade and Migrate Roles
        const { data: targetMemberships } = await supabase.from('family_memberships').select('*').eq('family_space_id', targetId);
        
        if (targetMemberships && targetMemberships.length > 0) {
            for (let mem of targetMemberships) {
                // If they are owner/admin in target, they become member in source.
                // Otherwise they keep their member role.
                const newRole = (mem.role === 'owner' || mem.role === 'admin') ? 'member' : mem.role;
                
                // Check if they already exist in source space
                const { data: existingSrcMem } = await supabase
                    .from('family_memberships')
                    .select('id')
                    .eq('family_space_id', sourceId)
                    .eq('user_id', mem.user_id)
                    .maybeSingle();

                if (!existingSrcMem) {
                    await supabase.from('family_memberships').insert({
                        family_space_id: sourceId,
                        user_id: mem.user_id,
                        role: newRole,
                        status: mem.status
                    });
                }
            }
            // Delete old memberships to prevent clutter
            await supabase.from('family_memberships').delete().eq('family_space_id', targetId);
        }

        // 5. Update Merge Request Status
        await supabase.from('family_merge_requests').update({ status: 'completed' }).eq('id', id);

        // 6. Archive Target Family Space
        await supabase.from('family_spaces').update({ 
            status: 'archived',
            name: `[MERGED] ${request.target_space_id}` // visually mark it
        }).eq('id', targetId);

        await logActivity(user.id, 'EXECUTE_MERGE', 'family_spaces', sourceId, sourceId, { merged_with: targetId });

        res.json({ message: 'Family Merge Completed Successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * 7. Search family spaces for merge suggestion/initiation
 */
export const searchFamilies = async (req, res) => {
    try {
        const { query, excludeId } = req.query;
        if (!query) {
            return res.json([]);
        }

        const hasTable = await tableExists('family_spaces');
        if (hasTable) {
            let dbQuery = supabase
                .from('family_spaces')
                .select('id, name, code, description, visibility, cover_image');

            if (excludeId) {
                dbQuery = dbQuery.neq('id', excludeId);
            }

            dbQuery = dbQuery.or(`name.ilike.%${query}%,code.ilike.%${query}%,description.ilike.%${query}%`);

            const { data, error } = await dbQuery.limit(10);
            if (error) throw error;
            return res.json(data || []);
        } else {
            const db = readJsonDb();
            let spaces = db.family_spaces || [];
            if (excludeId) {
                spaces = spaces.filter(s => s.id !== excludeId);
            }
            const q = query.toLowerCase();
            spaces = spaces.filter(s => 
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.code && s.code.toLowerCase().includes(q)) ||
                (s.description && s.description.toLowerCase().includes(q))
            );
            return res.json(spaces.slice(0, 10));
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * 8. Get Merge Requests for a specific Family Owner
 */
export const getOwnerMergeRequests = async (req, res) => {
    try {
        const { user } = req;
        const { familySpaceId } = req.query;

        if (!familySpaceId) {
            return res.status(400).json({ error: 'familySpaceId is required' });
        }

        const hasTable = await tableExists('family_merge_requests');
        if (hasTable) {
            const { data: membership } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('family_space_id', familySpaceId)
                .eq('user_id', user.id)
                .single();

            if (!membership || !['owner', 'admin'].includes(membership.role)) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const { data, error } = await supabase
                .from('family_merge_requests')
                .select('*')
                .or(`source_space_id.eq.${familySpaceId},target_space_id.eq.${familySpaceId}`)
                .order('created_at', { ascending: false });

            if (error) throw error;

            const spaceIds = [...new Set((data || []).flatMap(r => [r.source_space_id, r.target_space_id]))];
            const userIds = [...new Set((data || []).map(r => r.initiator_user_id))];

            const [spacesRes, usersRes] = await Promise.all([
                supabase.from('family_spaces').select('id, name').in('id', spaceIds),
                supabase.from('users').select('id, email, first_name, last_name').in('id', userIds)
            ]);

            const spacesMap = {};
            if (spacesRes.data) {
                spacesRes.data.forEach(s => { spacesMap[s.id] = s.name; });
            }

            const usersMap = {};
            if (usersRes.data) {
                usersRes.data.forEach(u => {
                    usersMap[u.id] = u.email || `${u.first_name} ${u.last_name}`.trim();
                });
            }

            const enriched = (data || []).map(r => ({
                ...r,
                source_family_name: spacesMap[r.source_space_id] || 'Unknown Family',
                target_family_name: spacesMap[r.target_space_id] || 'Unknown Family',
                requested_by_email: usersMap[r.initiator_user_id] || 'Admin'
            }));

            return res.json(enriched);
        } else {
            const db = readJsonDb();
            const memberships = db.family_memberships || [];
            const isMember = memberships.find(m => m.family_space_id === familySpaceId && m.user_id === user.id);
            if (!isMember || !['owner', 'admin'].includes(isMember.role)) {
                return res.status(403).json({ error: 'Access denied' });
            }

            let requests = db.family_merge_requests || [];
            requests = requests.filter(r => r.source_space_id === familySpaceId || r.target_space_id === familySpaceId);

            const spaces = db.family_spaces || [];
            const users = db.users || [];

            const enriched = requests.map(r => {
                const src = spaces.find(s => s.id === r.source_space_id);
                const tgt = spaces.find(s => s.id === r.target_space_id);
                const initUser = users.find(u => u.id === r.initiator_user_id);

                return {
                    ...r,
                    source_family_name: src ? src.name : 'Unknown Family',
                    target_family_name: tgt ? tgt.name : 'Unknown Family',
                    requested_by_email: initUser ? (initUser.email || `${initUser.first_name} ${initUser.last_name}`.trim()) : 'Admin'
                };
            });

            return res.json(enriched);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
