import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';

/**
 * Submit a claim request for a Person ID.
 */
export const submitClaim = async (req, res) => {
    try {
        const { person_id, family_space_id, evidence_url } = req.body;
        const { user } = req;

        const { data: space } = await supabase.from('family_spaces').select('settings').eq('id', family_space_id).single();
        const settings = space?.settings || {};
        
        let initialStatus = 'pending';

        if (settings.autoApproveCousins) {
            const { data: rels } = await supabase.from('person_relations')
                .select('person_id_1, person_id_2')
                .or(`person_id_1.eq.${person_id},person_id_2.eq.${person_id}`);
                
            if (rels && rels.length > 0) {
                const relatedIds = rels.map(r => r.person_id_1 === person_id ? r.person_id_2 : r.person_id_1);
                const { data: claimedRelatives } = await supabase.from('persons')
                    .select('id')
                    .in('id', relatedIds)
                    .not('claimed_by', 'is', null)
                    .limit(1);
                    
                if (claimedRelatives && claimedRelatives.length > 0) {
                    initialStatus = 'approved';
                }
            }
        }

        const { data, error } = await supabase
            .from('claims')
            .insert({
                user_id: user.id,
                person_id,
                family_space_id,
                evidence_url: evidence_url || null,
                status: initialStatus,
                claimed_at: initialStatus === 'approved' ? new Date().toISOString() : null
            })
            .select()
            .single();

        if (error) throw error;

        if (initialStatus === 'approved') {
            const { data: personData } = await supabase.from('persons')
                .update({ claimed_by: user.id, member_status: 'active_user' })
                .eq('id', person_id)
                .select('pending_role')
                .single();

            if (personData?.pending_role) {
                await supabase.from('family_memberships').upsert({
                    user_id: user.id,
                    family_space_id,
                    role: personData.pending_role,
                    status: 'active'
                }, { onConflict: 'user_id, family_space_id' });
                
                await supabase.from('persons').update({ pending_role: null }).eq('id', person_id);
            } else {
                await supabase.from('family_memberships').upsert({
                    user_id: user.id,
                    family_space_id,
                    role: 'member',
                    status: 'active'
                }, { onConflict: 'user_id, family_space_id' });
            }
        }

        await logActivity(user.id, 'SUBMIT_CLAIM', 'claims', data.id, null, data);

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Resolve a claim (Approve/Reject).
 */
export const resolveClaim = async (req, res) => {
    try {
        const { claim_id, status } = req.body;
        const { user } = req;

        const { data: claim, error: cError } = await supabase
            .from('claims')
            .update({
                status,
                claimed_at: status === 'approved' ? new Date().toISOString() : null
            })
            .eq('id', claim_id)
            .select()
            .single();

        if (cError) throw cError;

        // If approved, update the persons table to link the user
        if (status === 'approved') {
            const { data: personData, error: pError } = await supabase
                .from('persons')
                .update({ claimed_by: claim.user_id, member_status: 'active_user' })
                .eq('id', claim.person_id)
                .select('pending_role')
                .single();

            if (pError) throw pError;

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

        await logActivity(user.id, 'RESOLVE_CLAIM', 'claims', claim_id, null, { status });

        res.json(claim);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


/**

/**
 * Fetch all pending identity claims and approvals for a specific family space
 * Admin-only view
 */
export const getFamilyApprovals = async (req, res) => {
    try {
        const { family_space_id, status } = req.query;

        if (!family_space_id) {
            return res.status(400).json({ error: 'family_space_id is required' });
        }

        let query = supabase
            .from('claims')
            .select(`
                id,
                status,
                details,
                evidence_url,
                created_at,
                user:user_id(first_name, last_name, avatar_url),
                person:person_id(id, full_name, birth_date, death_date)
            `)
            .eq('family_space_id', family_space_id);

        if (status && status !== 'All') {
            query = query.eq('status', status.toLowerCase());
        }

        const { data: claims, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        // Map the results for the frontend UI
        const mappedApprovals = claims.map(claim => {
            let requestorName = 'Unknown User';
            if (claim.user) {
                requestorName = `${claim.user.first_name || ''} ${claim.user.last_name || ''}`.trim() || 'Unknown User';
            }

            let years = 'Unknown';
            let shortId = '';
            let targetName = 'Unknown Member';
            if (claim.person) {
                targetName = claim.person.full_name;
                const bYear = claim.person.birth_date ? claim.person.birth_date.split('-')[0] : '';
                const dYear = claim.person.death_date ? claim.person.death_date.split('-')[0] : (bYear ? 'Present' : '');
                if (bYear) years = `${bYear}-${dYear}`;
                
                shortId = `ID#${claim.person.id.split('-')[0]}`;
            }

            return {
                id: claim.id,
                requestor_name: requestorName,
                requestor_avatar: claim.user?.avatar_url || null,
                target_person_name: targetName,
                target_person_desc: `${years}. ${shortId}`.trim(),
                proofs: claim.evidence_url ? (Array.isArray(claim.evidence_url) ? claim.evidence_url : [claim.evidence_url]) : [],
                comment: claim.details || "No comment provided.",
                status: claim.status,
                created_at: claim.created_at
            };
        });

        res.json(mappedApprovals);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
