import { supabase } from '../../config/supabaseClient.js';
import { tableExists, readJsonDb, writeJsonDb } from '../../utils/dbHelper.js';

async function getAssignedSpaceIdsForUser(userId, userRole) {
    const assignedSpaceIds = new Set();

    const hasCouncilAssign = await tableExists('council_family_assignments');
    if (hasCouncilAssign) {
        const { data: assignments } = await supabase
            .from('council_family_assignments')
            .select('family_space_id')
            .eq('council_user_id', userId);
        (assignments || []).forEach(a => {
            if (a.family_space_id) assignedSpaceIds.add(a.family_space_id);
        });
    }

    const { data: staffRows } = await supabase
        .from('family_space_staff')
        .select('family_space_id, role')
        .eq('user_id', userId);
    (staffRows || []).forEach(s => {
        if (s.family_space_id && ['council-admin', 'editor', 'council', 'owner', 'family-admin'].includes(s.role?.toLowerCase())) {
            assignedSpaceIds.add(s.family_space_id);
        }
    });

    const { data: memRows } = await supabase
        .from('family_memberships')
        .select('family_space_id, role')
        .eq('user_id', userId);
    (memRows || []).forEach(m => {
        if (m.family_space_id && ['council-admin', 'editor', 'council', 'owner', 'family-admin'].includes(m.role?.toLowerCase())) {
            assignedSpaceIds.add(m.family_space_id);
        }
    });

    return Array.from(assignedSpaceIds);
}

/**
 * Get all pending approvals for the Council.
 * This includes member claims, branch creation requests, etc.
 */
export const getCouncilApprovals = async (req, res) => {
    try {
        const { type } = req.query; // claims, branches, content
        let results = {};

        if (!type || type === 'claims') {
            const { data } = await supabase.from('claims').select('*, users(first_name, last_name), persons(full_name)').eq('status', 'pending');
            results.claims = data || [];
        }

        if (!type || type === 'branches') {
            const { data } = await supabase.from('family_branches').select('*, family_spaces(name)').eq('status', 'pending');
            results.branches = data || [];
        }

        if (!type || type === 'sensitive_changes') {
            const hasTable = await tableExists('sensitive_changes');
            if (hasTable) {
                const { data } = await supabase.from('sensitive_changes').select('*, family_spaces(name)').eq('status', 'pending');
                results.sensitive_changes = data || [];
            } else {
                const db = readJsonDb();
                results.sensitive_changes = (db.sensitive_changes || []).filter(c => c.status === 'pending');
            }
        }

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Cast a vote or make a final decision on a request.
 */
export const resolveCouncilRequest = async (req, res) => {
    try {
        const { target_type, target_id, action, notes } = req.body;
        const { user } = req;

        if (!['approved', 'rejected'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action' });
        }

        // Update the target record
        const { data, error } = await supabase
            .from(target_type)
            .update({ 
                status: action,
            })
            .eq('id', target_id)
            .select()
            .single();

        if (error) throw error;

        // If this is an approved Governance Unlock, we need to mark the previous Lock as unlocked.
        if (target_type === 'sensitive_changes' && data.change_type === 'Governance Unlock' && action === 'approved') {
            await supabase
                .from('sensitive_changes')
                .update({ status: 'unlocked' })
                .eq('family_space_id', data.family_space_id)
                .eq('change_type', 'Governance Lock')
                .eq('status', 'approved');
        }

        // Log decision to Council Decision table
        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: `COUNCIL_RESOLVE_${action.toUpperCase()}`,
            target_type,
            target_id,
            details: { notes }
        });

        res.json({ message: 'Council decision recorded', data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get system-wide activity summary for the Council dashboard.
 */
export const getCouncilDashboard = async (req, res) => {
    try {
        const { familySpaceId } = req.query;
        let targetFamilySpaceIds = await getAssignedSpaceIdsForUser(req.user.id, req.user.role);

        let selectedSpaceIds = targetFamilySpaceIds;
        if (familySpaceId) {
            if (req.user.role === 'super_admin' || targetFamilySpaceIds.includes(familySpaceId)) {
                selectedSpaceIds = [familySpaceId];
            } else {
                return res.status(403).json({ error: 'Access denied to this family space' });
            }
        }

        if (selectedSpaceIds.length === 0) {
            return res.json({
                stats: {
                    total_members: 0,
                    active_branches: 0,
                    pending_approvals: 0
                },
                recent_activity: []
            });
        }

        // 1. Fetch total members count
        const { count: totalMembers } = await supabase
            .from('family_memberships')
            .select('*', { count: 'exact', head: true })
            .in('family_space_id', selectedSpaceIds);

        // 2. Fetch total active branches count
        const { count: totalBranches } = await supabase
            .from('family_branches')
            .select('*', { count: 'exact', head: true })
            .in('family_space_id', selectedSpaceIds);

        // 3. Fetch pending approvals (claims and pending branches)
        const { count: pendingClaims } = await supabase
            .from('claims')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
            .in('family_space_id', selectedSpaceIds);

        const { count: pendingBranches } = await supabase
            .from('family_branches')
            .select('*', { count: 'exact', head: true })
            .eq('status', 'pending')
            .in('family_space_id', selectedSpaceIds);

        const pendingApprovals = (pendingClaims || 0) + (pendingBranches || 0);

        // 4. Fetch recent activity (filtered by membership actor IDs)
        const { data: members } = await supabase
            .from('family_memberships')
            .select('user_id')
            .in('family_space_id', selectedSpaceIds);
        const userIds = (members || []).map(m => m.user_id).filter(Boolean);

        let recentActivity = [];
        if (userIds.length > 0) {
            const { data, error: actError } = await supabase
                .from('audit_logs')
                .select('*, users!actor_id(first_name, last_name)')
                .in('actor_id', userIds)
                .order('created_at', { ascending: false })
                .limit(20);
            if (!actError) {
                recentActivity = data || [];
            }
        }

        res.json({
            stats: {
                total_members: totalMembers || 0,
                active_branches: totalBranches || 0,
                pending_approvals: pendingApprovals || 0
            },
            recent_activity: recentActivity
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get branches for the Council Admin's assigned family spaces.
 */
export const getCouncilBranches = async (req, res) => {
    try {
        const { familySpaceId } = req.query;
        let targetFamilySpaceIds = await getAssignedSpaceIdsForUser(req.user.id, req.user.role);

        let selectedSpaceIds = targetFamilySpaceIds;
        if (familySpaceId) {
            if (req.user.role === 'super_admin' || targetFamilySpaceIds.includes(familySpaceId)) {
                selectedSpaceIds = [familySpaceId];
            } else {
                return res.status(403).json({ error: 'Access denied to this family space' });
            }
        }

        if (selectedSpaceIds.length === 0) {
            return res.json([]);
        }

        const branchesTableExists = await tableExists('family_branches');
        if (branchesTableExists) {
            const { data: branches, error } = await supabase
                .from('family_branches')
                .select('*, family_spaces(name)')
                .in('family_space_id', selectedSpaceIds);

            if (error) throw error;

            // Enrich branches with leader names and member counts
            const personIds = Array.from(new Set(branches?.map(b => [b.head_person_id, b.root_person_id, b.branch_admin_id]).flat().filter(id => id)));
            const { data: leaders } = personIds.length > 0
                ? await supabase.from('persons').select('id, full_name, first_name, last_name').in('id', personIds)
                : { data: [] };

            const leaderMap = {};
            (leaders || []).forEach(l => { leaderMap[l.id] = l.full_name || `${l.first_name || ''} ${l.last_name || ''}`.trim(); });

            const enrichedBranches = await Promise.all((branches || []).map(async (branch) => {
                const { count: memberCount } = await supabase
                    .from('persons')
                    .select('*', { count: 'exact', head: true })
                    .eq('branch_id', branch.id);

                return {
                    ...branch,
                    leader_name: leaderMap[branch.head_person_id] || leaderMap[branch.branch_admin_id] || 'No Head Set',
                    members_count: memberCount || 0,
                    households_count: Math.ceil((memberCount || 0) / 3),
                    generations_count: 1, // Or calculate based on depth if available
                    activity_level: (memberCount || 0) > 10 ? 'High' : (memberCount || 0) > 3 ? 'Medium' : 'Low'
                };
            }));

            res.set({
                'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            return res.json(enrichedBranches);
        } else {
            const db = readJsonDb();
            const branches = (db.family_branches || []).filter(b => selectedSpaceIds.includes(b.family_space_id));
            return res.json(branches);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 1 & 2: Get assigned families for the Council Admin
 */
export const getAssignedFamilies = async (req, res) => {
    try {
        const userId = req.user.id;
        const assignedSpaceIds = new Set();

        // 1. From council_family_assignments
        const hasCouncilAssign = await tableExists('council_family_assignments');
        if (hasCouncilAssign) {
            const { data: assignments } = await supabase
                .from('council_family_assignments')
                .select('family_space_id')
                .eq('council_user_id', userId);
            (assignments || []).forEach(a => {
                if (a.family_space_id) assignedSpaceIds.add(a.family_space_id);
            });
        }

        // 2. From family_space_staff
        const { data: staffRows } = await supabase
            .from('family_space_staff')
            .select('family_space_id, role')
            .eq('user_id', userId);
        (staffRows || []).forEach(s => {
            if (s.family_space_id && ['council-admin', 'editor', 'council', 'owner', 'family-admin'].includes(s.role?.toLowerCase())) {
                assignedSpaceIds.add(s.family_space_id);
            }
        });

        // 3. From family_memberships
        const { data: memRows } = await supabase
            .from('family_memberships')
            .select('family_space_id, role')
            .eq('user_id', userId);
        (memRows || []).forEach(m => {
            if (m.family_space_id && ['council-admin', 'editor', 'council', 'owner', 'family-admin'].includes(m.role?.toLowerCase())) {
                assignedSpaceIds.add(m.family_space_id);
            }
        });

        const idsArray = Array.from(assignedSpaceIds);
        if (idsArray.length === 0) {
            return res.json([]);
        }

        const { data: spaces, error } = await supabase
            .from('family_spaces')
            .select('id, name, description, code, created_at')
            .in('id', idsArray);

        if (error) throw error;

        const formatted = (spaces || []).map(space => ({
            id: space.id,
            family_space_id: space.id,
            name: space.name,
            description: space.description,
            code: space.code,
            assigned_at: space.created_at
        }));

        return res.json(formatted);
    } catch (err) {
        console.error('getAssignedFamilies error:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 3: Get Cross-Family Governance Cases
 */
export const getGovernanceCases = async (req, res) => {
    try {
        const { familySpaceId, status, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const start = (pageNum - 1) * limitNum;
        const end = start + limitNum - 1;

        const hasTable = await tableExists('governance_cases');
        if (hasTable) {
            let query = supabase.from('governance_cases').select('*', { count: 'exact' });
            if (familySpaceId) query = query.eq('family_space_id', familySpaceId);
            if (status) query = query.eq('status', status);
            
            const { data, count, error } = await query
                .range(start, end)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return res.json({
                cases: data || [],
                totalCount: count || 0,
                totalPages: Math.ceil((count || 0) / limitNum),
                page: pageNum
            });
        } else {
            // Fallback to JSON DB
            const db = readJsonDb();
            let cases = db.governance_cases || [];

            if (familySpaceId) {
                cases = cases.filter(c => c.family_space_id === familySpaceId);
            }
            if (status) {
                cases = cases.filter(c => c.status === status);
            }

            const totalCount = cases.length;
            const sliced = cases.slice(start, start + limitNum);

            return res.json({
                cases: sliced,
                totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
                page: pageNum
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new Governance Case
 */
export const createGovernanceCase = async (req, res) => {
    try {
        const { familySpaceId, title, description, threshold = 50, endsAt } = req.body;
        const hasTable = await tableExists('governance_cases');

        const newCase = {
            family_space_id: familySpaceId,
            title,
            description,
            proposed_by: req.user.email,
            status: 'draft',
            stage: 'Drafting',
            votes_for: 0,
            votes_against: 0,
            threshold,
            ends_at: endsAt || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        };

        if (hasTable) {
            const { data, error } = await supabase
                .from('governance_cases')
                .insert(newCase)
                .select()
                .single();
            if (error) throw error;
            return res.status(201).json(data);
        } else {
            const db = readJsonDb();
            newCase.id = `gov_${Date.now()}`;
            db.governance_cases = db.governance_cases || [];
            db.governance_cases.push(newCase);
            writeJsonDb(db);
            return res.status(201).json(newCase);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Cast a vote on a Governance Case
 */
export const voteGovernanceCase = async (req, res) => {
    try {
        const { id } = req.params;
        const { vote } = req.body; // 'for' or 'against'
        if (!['for', 'against'].includes(vote)) {
            return res.status(400).json({ error: 'Vote must be either "for" or "against"' });
        }

        const hasTable = await tableExists('governance_cases');
        if (hasTable) {
            const current = await supabase.from('governance_cases').select('votes_for, votes_against').eq('id', id).single();
            if (current.error) throw current.error;

            const updates = {};
            if (vote === 'for') {
                updates.votes_for = (current.data.votes_for || 0) + 1;
            } else {
                updates.votes_against = (current.data.votes_against || 0) + 1;
            }

            const { data, error } = await supabase
                .from('governance_cases')
                .update(updates)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return res.json(data);
        } else {
            const db = readJsonDb();
            const caseItem = (db.governance_cases || []).find(c => c.id === id);
            if (!caseItem) return res.status(404).json({ error: 'Governance case not found' });

            if (vote === 'for') {
                caseItem.votes_for = (caseItem.votes_for || 0) + 1;
            } else {
                caseItem.votes_against = (caseItem.votes_against || 0) + 1;
            }

            writeJsonDb(db);
            return res.json(caseItem);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 4: Dispute Queue
 */
export const getDisputes = async (req, res) => {
    try {
        const { familySpaceId, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const start = (pageNum - 1) * limitNum;

        const hasTable = await tableExists('disputes');
        if (hasTable) {
            let query = supabase.from('disputes').select('*', { count: 'exact' });
            if (familySpaceId) query = query.eq('family_space_id', familySpaceId);
            
            const { data, count, error } = await query
                .range(start, start + limitNum - 1)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return res.json({
                disputes: data || [],
                totalCount: count || 0,
                totalPages: Math.ceil((count || 0) / limitNum),
                page: pageNum
            });
        } else {
            const db = readJsonDb();
            let disputes = db.disputes || [];
            if (familySpaceId) {
                disputes = disputes.filter(d => d.family_space_id === familySpaceId);
            }
            const totalCount = disputes.length;
            const sliced = disputes.slice(start, start + limitNum);
            return res.json({
                disputes: sliced,
                totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
                page: pageNum
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Resolve Dispute
 */
export const resolveDispute = async (req, res) => {
    try {
        const { id } = req.params;
        const { resolutionNotes } = req.body;

        const hasTable = await tableExists('disputes');
        if (hasTable) {
            const { data, error } = await supabase
                .from('disputes')
                .update({ status: 'resolved', resolved_notes: resolutionNotes })
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return res.json(data);
        } else {
            const db = readJsonDb();
            const dispute = (db.disputes || []).find(d => d.id === id);
            if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

            dispute.status = 'resolved';
            dispute.resolved_notes = resolutionNotes;

            writeJsonDb(db);
            return res.json(dispute);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 5: Lineage Claim Review (combining Supabase claims + JSON claims)
 */
export const getLineageClaims = async (req, res) => {
    try {
        const { familySpaceId, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const start = (pageNum - 1) * limitNum;

        // Fetch claims from real Supabase table
        const { data: dbClaims, error: claimsError } = await supabase
            .from('claims')
            .select('*, users(first_name, last_name, email), persons(full_name, clan_tree_id)');

        if (claimsError) throw claimsError;

        let combined = (dbClaims || []).map(c => ({
            id: c.id,
            family_space_id: c.persons?.clan_tree_id || null, // approximated
            person_name: c.persons?.full_name || 'Unknown Person',
            requested_by: c.users ? `${c.users.first_name || ''} ${c.users.last_name || ''}`.trim() || c.users.email : 'Unknown User',
            relationship: c.details?.relationship || 'Lineage Connection',
            evidence_url: c.details?.evidence_url || c.evidence_url || '',
            status: c.status,
            created_at: c.created_at
        }));

        // Load JSON claims for mock spaces too
        const db = readJsonDb();
        const jsonClaims = db.lineage_claims || [];
        combined = [...combined, ...jsonClaims];

        // Filter by space if requested
        if (familySpaceId) {
            combined = combined.filter(c => c.family_space_id === familySpaceId);
        }

        const totalCount = combined.length;
        const sliced = combined.slice(start, start + limitNum);

        return res.json({
            claims: sliced,
            totalCount,
            totalPages: Math.ceil(totalCount / limitNum),
            page: pageNum
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 6: Sensitive Change Approval
 */
export const getSensitiveChanges = async (req, res) => {
    try {
        const { familySpaceId, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const start = (pageNum - 1) * limitNum;

        const hasTable = await tableExists('sensitive_changes');
        if (hasTable) {
            let query = supabase.from('sensitive_changes').select('*', { count: 'exact' });
            if (familySpaceId) query = query.eq('family_space_id', familySpaceId);
            
            const { data, count, error } = await query
                .range(start, start + limitNum - 1)
                .order('created_at', { ascending: false });

            if (error) throw error;
            return res.json({
                changes: data || [],
                totalCount: count || 0,
                totalPages: Math.ceil((count || 0) / limitNum),
                page: pageNum
            });
        } else {
            const db = readJsonDb();
            let changes = db.sensitive_changes || [];
            if (familySpaceId) {
                changes = changes.filter(c => c.family_space_id === familySpaceId);
            }
            const totalCount = changes.length;
            const sliced = changes.slice(start, start + limitNum);
            return res.json({
                changes: sliced,
                totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
                page: pageNum
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const resolveSensitiveChange = async (req, res) => {
    try {
        const { id } = req.params;
        const action = req.body.action || req.body.status; // 'approved' or 'rejected'

        const hasTable = await tableExists('sensitive_changes');
        if (hasTable) {
            const { data, error } = await supabase
                .from('sensitive_changes')
                .update({ status: action })
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return res.json(data);
        } else {
            const db = readJsonDb();
            const change = (db.sensitive_changes || []).find(c => c.id === id);
            if (!change) return res.status(404).json({ error: 'Sensitive change request not found' });

            change.status = action;
            writeJsonDb(db);
            return res.json(change);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 7: Family Merge Request Review
 */
export const getMergeRequests = async (req, res) => {
    try {
        const { familySpaceId, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const start = (pageNum - 1) * limitNum;

        const hasTable = await tableExists('family_merge_requests');
        if (hasTable) {
            let query = supabase.from('family_merge_requests').select('*', { count: 'exact' });
            query = query.neq('status', 'pending_target_approval');
            if (familySpaceId) {
                query = query.or(`source_space_id.eq.${familySpaceId},target_space_id.eq.${familySpaceId}`);
            }

            const { data, count, error } = await query
                .range(start, start + limitNum - 1)
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

            return res.json({
                requests: enriched,
                merges: enriched,
                totalCount: count || 0,
                totalPages: Math.ceil((count || 0) / limitNum),
                page: pageNum
            });
        } else {
            const db = readJsonDb();
            let requests = db.family_merge_requests || [];
            requests = requests.filter(r => r.status !== 'pending_target_approval');
            if (familySpaceId) {
                requests = requests.filter(r => r.source_space_id === familySpaceId || r.target_space_id === familySpaceId);
            }
            const totalCount = requests.length;
            const sliced = requests.slice(start, start + limitNum);

            const spaces = db.family_spaces || [];
            const users = db.users || [];

            const enriched = sliced.map(r => {
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

            return res.json({
                requests: enriched,
                merges: enriched,
                totalCount,
                totalPages: Math.ceil(totalCount / limitNum),
                page: pageNum
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const resolveMergeRequest = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // 'approved' or 'rejected'
        const { user } = req;

        const hasTable = await tableExists('family_merge_requests');
        if (hasTable) {
            if (action === 'rejected') {
                const { data, error } = await supabase
                    .from('family_merge_requests')
                    .update({ status: 'rejected' })
                    .eq('id', id)
                    .select()
                    .single();
                if (error) throw error;
                return res.json(data);
            }

            if (action === 'approved') {
                const { data: request, error: fetchErr } = await supabase
                    .from('family_merge_requests')
                    .select('*')
                    .eq('id', id)
                    .single();

                if (fetchErr || !request) throw new Error('Merge request not found.');

                const sourceId = request.source_space_id;
                const targetId = request.target_space_id;

                await supabase.from('persons').update({ family_space_id: sourceId }).eq('family_space_id', targetId);
                await supabase.from('family_branches').update({ family_space_id: sourceId }).eq('family_space_id', targetId);
                await supabase.from('clan_trees').update({ family_space_id: sourceId }).eq('family_space_id', targetId);

                const { data: targetMemberships } = await supabase.from('family_memberships').select('*').eq('family_space_id', targetId);
                
                if (targetMemberships && targetMemberships.length > 0) {
                    for (let mem of targetMemberships) {
                        const newRole = (mem.role === 'owner' || mem.role === 'admin') ? 'member' : mem.role;
                        
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
                    await supabase.from('family_memberships').delete().eq('family_space_id', targetId);
                }

                const { data: updatedRequest, error: updateErr } = await supabase
                    .from('family_merge_requests')
                    .update({ status: 'completed' })
                    .eq('id', id)
                    .select()
                    .single();

                if (updateErr) throw updateErr;

                await supabase.from('family_spaces').update({ 
                    status: 'archived',
                    name: `[MERGED] ${request.target_space_id}`
                }).eq('id', targetId);

                if (typeof logActivity === 'function') {
                    await logActivity(user?.id || 'system', 'EXECUTE_MERGE', 'family_spaces', sourceId, sourceId, { merged_with: targetId });
                }

                return res.json(updatedRequest);
            }
        } else {
            const db = readJsonDb();
            const request = (db.family_merge_requests || []).find(r => r.id === id);
            if (!request) return res.status(404).json({ error: 'Merge request not found' });

            if (action === 'rejected') {
                request.status = 'rejected';
                writeJsonDb(db);
                return res.json(request);
            }

            if (action === 'approved') {
                const sourceId = request.source_space_id;
                const targetId = request.target_space_id;

                if (db.persons) {
                    db.persons = db.persons.map(p => {
                        if (p.family_space_id === targetId) return { ...p, family_space_id: sourceId };
                        return p;
                    });
                }

                if (db.family_branches) {
                    db.family_branches = db.family_branches.map(b => {
                        if (b.family_space_id === targetId) return { ...b, family_space_id: sourceId };
                        return b;
                    });
                }

                if (db.clan_trees) {
                    db.clan_trees = db.clan_trees.map(t => {
                        if (t.family_space_id === targetId) return { ...t, family_space_id: sourceId };
                        return t;
                    });
                }

                if (db.family_memberships) {
                    const targetMemberships = db.family_memberships.filter(m => m.family_space_id === targetId);
                    targetMemberships.forEach(mem => {
                        const newRole = (mem.role === 'owner' || mem.role === 'admin') ? 'member' : mem.role;
                        const exists = db.family_memberships.find(m => m.family_space_id === sourceId && m.user_id === mem.user_id);
                        if (!exists) {
                            db.family_memberships.push({
                                ...mem,
                                id: `mem-${Math.random().toString(36).substring(7)}`,
                                family_space_id: sourceId,
                                role: newRole
                            });
                        }
                    });
                    db.family_memberships = db.family_memberships.filter(m => m.family_space_id !== targetId);
                }

                request.status = 'completed';

                if (db.family_spaces) {
                    db.family_spaces = db.family_spaces.map(s => {
                        if (s.id === targetId) return { ...s, status: 'archived', name: `[MERGED] ${s.name}` };
                        return s;
                    });
                }

                writeJsonDb(db);
                return res.json(request);
            }
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 8: Voting Configuration
 */
export const getVotingConfigs = async (req, res) => {
    try {
        const { familySpaceId } = req.query;
        if (!familySpaceId) return res.status(400).json({ error: 'familySpaceId query parameter is required' });

        const hasTable = await tableExists('voting_configurations');
        if (hasTable) {
            const { data, error } = await supabase
                .from('voting_configurations')
                .select('*')
                .eq('family_space_id', familySpaceId)
                .maybeSingle();
            if (error) throw error;
            return res.json(data || null);
        } else {
            const db = readJsonDb();
            const config = (db.voting_configurations || []).find(c => c.family_space_id === familySpaceId);
            return res.json(config || null);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const saveVotingConfig = async (req, res) => {
    try {
        const { familySpaceId, majorityRule, thresholdPercentage, minQuorum } = req.body;
        if (!familySpaceId) return res.status(400).json({ error: 'familySpaceId is required' });

        const hasTable = await tableExists('voting_configurations');
        const updateData = {
            family_space_id: familySpaceId,
            majority_rule: majorityRule,
            threshold_percentage: thresholdPercentage,
            min_quorum: minQuorum,
            updated_at: new Date().toISOString()
        };

        if (hasTable) {
            const { data, error } = await supabase
                .from('voting_configurations')
                .upsert(updateData, { onConflict: 'family_space_id' })
                .select()
                .single();
            if (error) throw error;
            return res.json(data);
        } else {
            const db = readJsonDb();
            db.voting_configurations = db.voting_configurations || [];
            let index = db.voting_configurations.findIndex(c => c.family_space_id === familySpaceId);

            if (index >= 0) {
                db.voting_configurations[index] = { ...db.voting_configurations[index], ...updateData };
            } else {
                updateData.id = `vote_cfg_${Date.now()}`;
                db.voting_configurations.push(updateData);
            }

            writeJsonDb(db);
            return res.json(db.voting_configurations.find(c => c.family_space_id === familySpaceId));
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Requirement 10: Audit Log Across Assigned Families
 */
export const getCouncilAuditLogs = async (req, res) => {
    try {
        const { familySpaceId, page = 1, limit = 10 } = req.query;
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const start = (pageNum - 1) * limitNum;
        const end = start + limitNum - 1;

        let targetFamilySpaceIds = await getAssignedSpaceIdsForUser(req.user.id, req.user.role);

        let selectedSpaceIds = targetFamilySpaceIds;
        if (familySpaceId) {
            if (req.user.role === 'super_admin' || targetFamilySpaceIds.includes(familySpaceId)) {
                selectedSpaceIds = [familySpaceId];
            } else {
                return res.status(403).json({ error: 'Access denied to this family space' });
            }
        }

        if (selectedSpaceIds.length === 0) {
            return res.json({
                logs: [],
                totalCount: 0,
                totalPages: 0,
                page: pageNum
            });
        }

        // Fetch user IDs for memberships of the selected spaces
        const { data: members } = await supabase
            .from('family_memberships')
            .select('user_id')
            .in('family_space_id', selectedSpaceIds);
        const userIds = (members || []).map(m => m.user_id).filter(Boolean);

        if (userIds.length === 0) {
            return res.json({
                logs: [],
                totalCount: 0,
                totalPages: 0,
                page: pageNum
            });
        }

        let query = supabase
            .from('audit_logs')
            .select('*, users!actor_id(first_name, last_name, email)', { count: 'exact' })
            .in('actor_id', userIds);

        const { data, count, error } = await query
            .range(start, end)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Map data to match the UI model format
        const logs = (data || []).map(log => ({
            id: log.id,
            created_at: log.created_at,
            action: log.action,
            target_type: log.target_type,
            target_id: log.target_id,
            ip_address: log.ip_address || '0.0.0.0',
            actor: log.users ? log.users : null,
            details: log.details || {}
        }));

        return res.json({
            logs,
            totalCount: count || 0,
            totalPages: Math.ceil((count || 0) / limitNum),
            page: pageNum
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get privacy settings for the Council Admin's family space
 */
export const getCouncilPrivacy = async (req, res) => {
    try {
        const { user } = req;
        const familySpaceId = req.query.familySpaceId || user.family_space_id;

        if (!familySpaceId) {
            return res.status(400).json({ error: 'Family space ID is required' });
        }

        const { data, error } = await supabase
            .from('family_spaces')
            .select('settings, visibility')
            .eq('id', familySpaceId)
            .single();

        if (error) throw error;

        const defaultSettings = {
            lineageVisibility: true,
            autoApproveCousins: false,
            sensitiveDataRedaction: true,
            postMortemAccess: true
        };

        const settings = data.settings || {};
        const privacySettings = {
            lineageVisibility: settings.lineageVisibility !== undefined ? settings.lineageVisibility : defaultSettings.lineageVisibility,
            autoApproveCousins: settings.autoApproveCousins !== undefined ? settings.autoApproveCousins : defaultSettings.autoApproveCousins,
            sensitiveDataRedaction: settings.sensitiveDataRedaction !== undefined ? settings.sensitiveDataRedaction : defaultSettings.sensitiveDataRedaction,
            postMortemAccess: settings.postMortemAccess !== undefined ? settings.postMortemAccess : defaultSettings.postMortemAccess,
            globalIndexing: data.visibility === 'Listed on marketplace'
        };

        res.json(privacySettings);
    } catch (err) {
        console.error('Error fetching council privacy settings:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update privacy settings for the Council Admin's family space
 */
export const updateCouncilPrivacy = async (req, res) => {
    try {
        const { user } = req;
        const familySpaceId = req.query.familySpaceId || user.family_space_id;
        
        if (!familySpaceId) {
            return res.status(400).json({ error: 'Family space ID is required' });
        }

        const { lineageVisibility, autoApproveCousins, sensitiveDataRedaction, postMortemAccess, globalIndexing } = req.body;

        // 1. Fetch existing settings
        const { data: existingSpace, error: fetchError } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', familySpaceId)
            .single();

        if (fetchError) throw fetchError;

        const existingSettings = existingSpace.settings || {};
        
        // 2. Update settings (merge — do not wipe Owner privacy / adminDelegations keys)
        const updatedSettings = {
            ...existingSettings,
            lineageVisibility: lineageVisibility !== undefined ? lineageVisibility : existingSettings.lineageVisibility,
            autoApproveCousins: autoApproveCousins !== undefined ? autoApproveCousins : existingSettings.autoApproveCousins,
            sensitiveDataRedaction: sensitiveDataRedaction !== undefined ? sensitiveDataRedaction : existingSettings.sensitiveDataRedaction,
            postMortemAccess: postMortemAccess !== undefined ? postMortemAccess : existingSettings.postMortemAccess
        };

        if (globalIndexing !== undefined) {
            updatedSettings.externalSearchIndexing = !!globalIndexing;
            updatedSettings.globalProfileVisibility = !!globalIndexing;
        }

        const updates = { settings: updatedSettings };
        if (globalIndexing !== undefined) {
            updates.visibility = globalIndexing ? 'Listed on marketplace' : 'Private (internal only)';
        }

        const { error: updateError } = await supabase
            .from('family_spaces')
            .update(updates)
            .eq('id', familySpaceId);

        if (updateError) throw updateError;

        // Log the activity
        if (typeof logActivity === 'function') {
            await logActivity(user.id, 'UPDATE_PRIVACY_SETTINGS', 'family_spaces', familySpaceId, familySpaceId);
        }

        res.json({ message: 'Privacy settings updated successfully', settings: updatedSettings });
    } catch (err) {
        console.error('Error updating council privacy settings:', err);
        res.status(500).json({ error: err.message });
    }
};
