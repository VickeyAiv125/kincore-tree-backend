import { supabase } from '../../config/supabaseClient.js';
import {
    loadFamilyGovernance,
    saveFamilyGovernance,
    normalizeGovernancePayload,
    assertGovernanceUnlocked,
    ROLE_HIERARCHY_ROWS,
    DEFAULT_GOVERNANCE
} from '../../utils/familyGovernancePolicy.js';
import { normalizeFamilyRole, readAdminDelegations } from '../../utils/familyRolePolicy.js';

const resolveActorFamilyRole = async (userId, familySpaceId) => {
    const { data } = await supabase
        .from('family_memberships')
        .select('role')
        .eq('family_space_id', familySpaceId)
        .eq('user_id', userId)
        .maybeSingle();
    return data ? normalizeFamilyRole(data.role) : null;
};

const assertCanManageGovernance = async (userId, familySpaceId) => {
    const role = await resolveActorFamilyRole(userId, familySpaceId);
    if (!role) {
        const err = new Error('You are not a member of this family space');
        err.status = 403;
        throw err;
    }
    if (role === 'owner') return role;

    if (role === 'family-admin' || role === 'co-admin') {
        const { data: space } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', familySpaceId)
            .maybeSingle();
        const dels = readAdminDelegations(space?.settings);
        if (dels.canModifyGovernanceRules) return role;
    }

    const err = new Error('Only Family Owner (or Admins delegated to modify governance) can change these policies');
    err.status = 403;
    throw err;
};

export const getSettings = async (req, res) => {
    try {
        const family_space_id = req.query.family_space_id || req.query.familySpaceId;
        if (!family_space_id) return res.status(400).json({ error: 'Family space ID required' });

        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const role = await resolveActorFamilyRole(userId, family_space_id);
        if (!role) return res.status(403).json({ error: 'You are not a member of this family space' });

        const governance = await loadFamilyGovernance(family_space_id);

        // Lock status for UI
        let isLocked = false;
        try {
            await assertGovernanceUnlocked(family_space_id);
        } catch (e) {
            if (e.isGovernanceLocked) isLocked = true;
        }

        const canEdit = role === 'owner' || (
            (role === 'family-admin' || role === 'co-admin')
            && (await (async () => {
                const { data: space } = await supabase.from('family_spaces').select('settings').eq('id', family_space_id).maybeSingle();
                return !!readAdminDelegations(space?.settings).canModifyGovernanceRules;
            })())
        );

        res.json({
            ...governance,
            family_space_id,
            actor_role: role,
            can_edit: canEdit,
            is_locked: isLocked,
            role_hierarchy: ROLE_HIERARCHY_ROWS.map((r) => ({
                role: r.label || r.role,
                key: r.key || r.role,
                authority: r.authority,
                scope: r.scope,
                level: r.level
            }))
        });
    } catch (err) {
        console.error('[governanceController.getSettings]', err);
        res.status(err.status || 500).json({ error: err.message });
    }
};

export const updateSettings = async (req, res) => {
    try {
        const { family_space_id, familySpaceId, ...settings } = req.body || {};
        const spaceId = family_space_id || familySpaceId;
        if (!spaceId) return res.status(400).json({ error: 'Family space ID required' });

        const userId = req.user?.id;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        await assertCanManageGovernance(userId, spaceId);
        await assertGovernanceUnlocked(spaceId);

        const payload = normalizeGovernancePayload(settings);
        const data = await saveFamilyGovernance(spaceId, payload, userId);

        try {
            await supabase.from('audit_logs').insert({
                actor_id: userId,
                action: 'FAMILY_GOVERNANCE_UPDATE',
                target_type: 'family_governance',
                target_id: data.id || spaceId,
                ip_address: req.ip || '0.0.0.0',
                details: {
                    family_space_id: spaceId,
                    financial_authority: payload.financial_authority,
                    asset_authority: payload.asset_authority,
                    permissions: payload.permissions,
                    source: data.source
                }
            });
        } catch (auditError) {
            console.error('Failed to log governance settings update:', auditError);
        }

        res.json({
            message: 'Governance policies updated',
            ...data,
            role_hierarchy: ROLE_HIERARCHY_ROWS.map((r) => ({
                role: r.label || r.role,
                key: r.key || r.role,
                authority: r.authority,
                scope: r.scope,
                level: r.level
            }))
        });
    } catch (err) {
        console.error('[governanceController.updateSettings]', err);
        res.status(err.status || 500).json({
            error: err.message,
            isGovernanceLocked: Boolean(err.isGovernanceLocked)
        });
    }
};

export const getGlobalFees = async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('fee_structures')
            .select('p2p_transfer_fee, mall_transaction_fee, liquidity_exit_fee')
            .limit(1)
            .maybeSingle();

        if (error) {
            if (error.code === 'PGRST116' || error.code === '42P01') {
                return res.json({ p2p_transfer_fee: 2.5, mall_transaction_fee: 1.2, liquidity_exit_fee: 5.0 });
            }
            throw error;
        }

        res.json(data || { p2p_transfer_fee: 2.5, mall_transaction_fee: 1.2, liquidity_exit_fee: 5.0 });
    } catch (err) {
        console.error('[governanceController.getGlobalFees]', err);
        res.status(500).json({ error: 'Internal server error while fetching fees' });
    }
};

// keep unused default import happy for tooling
void DEFAULT_GOVERNANCE;
