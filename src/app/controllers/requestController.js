import { supabase } from '../../config/supabaseClient.js';

/**
 * Get the current user's request history (from branch_edit_requests).
 */
export const getUserRequests = async (req, res) => {
    try {
        const { user } = req;
        const { status, search, family_space_id } = req.query;

        if (!family_space_id) {
            return res.status(400).json({ error: 'family_space_id is required' });
        }

        let query1 = supabase
            .from('branch_edit_requests')
            .select(`
                *,
                branch:branch_id(name),
                reviewer:reviewer_id(first_name, last_name)
            `)
            .eq('requested_by', user.id)
            .eq('family_space_id', family_space_id);

        let query2 = supabase
            .from('claims')
            .select(`
                *,
                person:person_id(full_name)
            `)
            .eq('user_id', user.id)
            .eq('family_space_id', family_space_id);

        if (status && status !== 'All') {
            query1 = query1.eq('status', status.toLowerCase());
            query2 = query2.eq('status', status.toLowerCase());
        }

        const [branchRes, claimsRes] = await Promise.all([
            query1,
            query2
        ]);

        if (branchRes.error) throw branchRes.error;
        if (claimsRes.error) throw claimsRes.error;

        let results = [];

        // Format branch edit requests
        const formattedBranchReqs = branchRes.data.map(r => {
            const branchName = r.branch ? r.branch.name : 'Unknown Member';
            const role = 'Existing Family Member';
            
            // Compute title and difference string
            let changeDiff = '';
            let title = 'Data Change';
            
            if (r.request_type === 'update_info' && r.current_value && r.proposed_value) {
                const curr = r.current_value;
                const prop = r.proposed_value;
                
                if (curr.birth_date !== prop.birth_date) {
                    title = 'Birthdate Update';
                    changeDiff = `${curr.birth_date || 'None'} change to ${prop.birth_date || 'None'}`;
                } else if (curr.first_name !== prop.first_name || curr.last_name !== prop.last_name) {
                    title = 'Name Update';
                    changeDiff = `${curr.first_name || ''} ${curr.last_name || ''} change to ${prop.first_name || ''} ${prop.last_name || ''}`.trim();
                } else if (curr.name !== prop.name) {
                    title = 'Name Update';
                    changeDiff = `${curr.name || ''} change to ${prop.name || ''}`;
                } else {
                    title = 'Profile Update';
                    changeDiff = 'Requested changes to profile details';
                }
            } else if (r.request_type === 'join_family' || r.request_type === 'add_member') {
                title = 'Branch Request';
                changeDiff = 'Requested to add or join this branch';
            }

            return {
                id: r.id,
                target_member: branchName,
                target_role: role,
                title,
                change_diff: changeDiff,
                status: r.status,
                reviewer: r.reviewer ? `${r.reviewer.first_name} ${r.reviewer.last_name}` : null,
                reason: r.reason,
                reviewer_comment: r.reviewer_comment,
                created_at: r.created_at,
                updated_at: r.updated_at,
                source: 'branch_edit_requests'
            };
        });

        // Format identity claims
        const formattedClaims = claimsRes.data.map(c => {
            const personName = c.person ? c.person.full_name : 'Unknown Member';
            let title = 'Identity Claim';
            let changeDiff = 'Requested to claim identity/ownership of this profile';

            // Check if it's an "Edit Profile" claim or an original "Identity Claim"
            if (c.type === 'edit') {
                title = 'Profile Edit Request';
                changeDiff = 'Requested changes to my claimed profile details';
            }

            return {
                id: c.id,
                target_member: personName,
                target_role: 'Tree Node',
                title,
                change_diff: changeDiff,
                status: c.status,
                reviewer: null,
                reason: c.details?.reason || '',
                reviewer_comment: c.rejection_reason || null,
                created_at: c.created_at,
                updated_at: c.updated_at || c.created_at,
                source: 'claims'
            };
        });

        results = [...formattedBranchReqs, ...formattedClaims];

        // Apply Search
        if (search) {
            const lowerSearch = search.toLowerCase();
            results = results.filter(req => {
                const targetName = (req.target_member || '').toLowerCase();
                return targetName.includes(lowerSearch);
            });
        }

        // Sort by created_at desc
        results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        res.json(results);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
