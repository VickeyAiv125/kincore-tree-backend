import { supabase } from '../../config/supabaseClient.js';

/**
 * Get comprehensive Dashboard Overview stats.
 */
export const getDashboardOverview = async (req, res) => {
    try {
        const { count: memberCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: claimCount } = await supabase.from('claims').select('*', { count: 'exact', head: true }).eq('status', 'pending');
        const { count: treeCount } = await supabase.from('clan_trees').select('*', { count: 'exact', head: true });
        const { data: ledgerData } = await supabase.from('kcc_ledger').select('amount');

        const kccBalance = ledgerData?.reduce((acc, curr) => acc + parseFloat(curr.amount || 0), 0) || 0;

        const performance = {
            member_growth: [
                { month: 'Jan', count: 100 }, { month: 'Feb', count: 150 }, { month: 'Mar', count: 200 },
                { month: 'Apr', count: 280 }, { month: 'May', count: 400 }, { month: 'Jun', count: 550 }
            ],
            claim_resolution: 95
        };

        const { data: activity } = await supabase
            .from('audit_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(10);

        res.json({
            stats: {
                total_members: memberCount,
                active_claims: claimCount,
                trees_planted: treeCount,
                storage_used: '75%',
                kcc_balance: kccBalance
            },
            performance,
            activity_feed: activity
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Quick Action: Add a person to any lineage tree.
 */
export const adminAddPerson = async (req, res) => {
    try {
        const { clan_tree_id, full_name, gender, birth_date, birth_place, privacy_mode } = req.body;
        const { user } = req;

        const { data, error } = await supabase
            .from('persons')
            .insert({
                clan_tree_id,
                full_name,
                gender,
                birth_date,
                birth_place,
                privacy_mode: privacy_mode || 'private'
            })
            .select().single();

        if (error) throw error;

        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: 'ADMIN_ADD_PERSON',
            target_type: 'persons',
            target_id: data.id,
            details: { full_name, clan_tree_id }
        });

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * List all pending claims for approval.
 */
export const getPendingClaims = async (req, res) => {
    try {
        let query = supabase
            .from('claims')
            .select(`*, user:users(first_name, last_name, email), person:persons(full_name)`)
            .eq('status', 'pending');

        let { data, error } = await query.order('created_at', { ascending: false });
        
        if (error && error.message.includes('created_at')) {
            const retry = await query.order('claimed_at', { ascending: false });
            data = retry.data;
            error = retry.error;
        }

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Approve or Reject a claim.
 */
export const resolveClaim = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body; // approved, rejected
        const { user } = req;

        const { data: claim, error: claimError } = await supabase.from('claims').select('*').eq('id', id).single();
        if (claimError) throw claimError;

        const { data, error } = await supabase.from('claims').update({ status: action }).eq('id', id).select().single();
        if (error) throw error;

        // If approved, update the person record and notify
        if (action === 'approved') {
            const { data: personData, error: personError } = await supabase
                .from('persons')
                .update({ claimed_by: claim.user_id, member_status: 'active_user' })
                .eq('id', claim.person_id)
                .select('pending_role')
                .single();
            if (personError) throw personError;

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

            await supabase.from('notifications').insert({
                user_id: claim.user_id,
                type: 'claim_approved',
                title: 'Claim Approved!',
                message: `Your claim for ${id} has been approved by the platform admin.`
            });
        }

        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: `CLAIM_${action.toUpperCase()}`,
            target_type: 'claims',
            target_id: id
        });

        res.json({ message: `Claim ${action}`, claim: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Migration Map Data: All persons with geo-data.
 */
export const getMigrationMap = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('persons')
            .select('id, full_name, birth_place, death_place, latitude, longitude, clan_tree_id')
            .not('latitude', 'is', null);

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get all users across the platform (Global) with search support.
 */
export const getUsers = async (req, res) => {
    try {
        const { search } = req.query;
        let query = supabase
            .from('users')
            .select(`
                *,
                admin:admin_users(role),
                memberships:family_memberships(family_space_id, role, family:family_spaces(name))
            `);

        if (search) {
            query = query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`);
        }

        const { data, error } = await query.order('created_at', { ascending: false }).limit(20);

        if (error) throw error;

        // Simplify for frontend mapping
        const processed = data.map(u => ({
            id: u.id,
            first_name: u.first_name,
            last_name: u.last_name,
            name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.email,
            email: u.email,
            role: u.admin?.role || 'user',
            status: u.status || 'active',
            last_login: u.last_login_at,
            avatar_url: u.avatar_url,
            family: u.memberships?.[0]?.family?.name || 'Individual'
        }));

        res.json({ users: processed });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get details for a specific user.
 */
export const getUserById = async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('users')
            .select(`
                *,
                admin:admin_users(role),
                memberships:family_memberships(*, family:family_spaces(*))
            `)
            .eq('id', id)
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
export const getGlobalTrees = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('clan_trees')
            .select(`*, family:family_spaces (name, owner:users (first_name, last_name, email))`)
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
export const getGlobalPersons = async (req, res) => {
    try {
        const { search } = req.query;
        let query = supabase.from('persons').select(`*, clan_tree:clan_trees (name, family_space_id)`);
        if (search) query = query.ilike('full_name', `%${search}%`);
        const { data, error } = await query.order('full_name', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// ... Moderation & Audit (from previous implementaiton)
export const getModerationQueue = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('posts')
            .select(`*, users (first_name, last_name)`)
            .eq('visibility', 'public')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

export const resolveModeration = async (req, res) => {
    try {
        const { target_type, target_id, action } = req.body;
        const { user } = req;
        let result;
        if (action === 'delete') result = await supabase.from(target_type).update({ deleted_at: new Date() }).eq('id', target_id);
        else if (action === 'approve') result = await supabase.from(target_type).update({ status: 'active' }).eq('id', target_id);
        if (result.error) throw result.error;
        await supabase.from('audit_logs').insert({ actor_id: user.id, action: `MODERATION_${action.toUpperCase()}`, target_type, target_id });
        res.json({ message: `Content ${action}ed successfully` });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getAuditLogs = async (req, res) => {
    try {
        const { data, error } = await supabase.from('audit_logs').select(`*, users!actor_id (first_name, last_name, email)`).order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

export const updateUserRole = async (req, res) => {
    try {
        const { id } = req.params; const { role } = req.body;
        const { data, error } = await supabase.from('admin_users').upsert({ user_id: id, role }, { onConflict: 'user_id' }).select().single();
        if (error) throw error;
        res.json({ message: 'Role updated successfully', admin_record: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

export const updateUserStatus = async (req, res) => {
    try {
        const { id } = req.params; const { status } = req.body;
        const { data, error } = await supabase.from('users').update({ status }).eq('id', id).select().single();
        if (error) throw error;
        res.json({ message: `User account ${status}`, user: data });
    } catch (err) { res.status(500).json({ error: err.message }); }
};

// Global Media / Mall / Ledger
export const getGlobalMedia = async (req, res) => {
    try {
        const { data, error } = await supabase.from('media').select(`*, user:users (first_name, last_name, email), family:family_spaces (name)`).order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getGlobalMarketplace = async (req, res) => {
    try {
        const { data, error } = await supabase.from('marketplace_listings').select(`*, seller:users (first_name, last_name, email)`).order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};

export const getKccLedger = async (req, res) => {
    try {
        const { data, error } = await supabase.from('kcc_ledger').select(`*, user:users (first_name, last_name, email)`).order('created_at', { ascending: false }).limit(200);
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
