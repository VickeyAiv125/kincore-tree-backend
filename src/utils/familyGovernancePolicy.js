/**
 * Family-scoped governance policy helpers (Owner Governance console).
 */
import { supabase } from '../config/supabaseClient.js';
import { tableExists, readJsonDb, writeJsonDb } from './dbHelper.js';
import { normalizeFamilyRole, FAMILY_ROLE_META } from './familyRolePolicy.js';

export const DEFAULT_GOVERNANCE_PERMISSIONS = {
    demoteAdmins: true,
    archiveBranches: true,
    approvalNeeded: true,
    moderateMedia: true,
    crossBranchEdits: false,
    mandatory2FA: false,
    proposeRules: true,
    adultVoting: true,
    financialReports: false
};

export const DEFAULT_GOVERNANCE = {
    rule_1: '',
    rule_2: '',
    rule_3: '',
    financial_authority: 100,
    asset_authority: 100,
    permissions: { ...DEFAULT_GOVERNANCE_PERMISSIONS }
};

export const ROLE_HIERARCHY_ROWS = [
    { role: 'owner', authority: 'Total Control', ...FAMILY_ROLE_META.owner },
    { role: 'family-admin', authority: 'Operations Manager', ...FAMILY_ROLE_META['family-admin'] },
    { role: 'co-admin', authority: 'Delegated Ops', ...FAMILY_ROLE_META['co-admin'] },
    { role: 'branch-admin', authority: 'Branch Governance', ...FAMILY_ROLE_META['branch-admin'] },
    { role: 'editor', authority: 'Content Contributor', ...FAMILY_ROLE_META.editor },
    { role: 'member', authority: 'View & Personal Edit', ...FAMILY_ROLE_META.member }
];

const clampAuthority = (v, fallback = 100) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
};

export const normalizeGovernancePermissions = (raw = {}) => ({
    ...DEFAULT_GOVERNANCE_PERMISSIONS,
    ...(raw && typeof raw === 'object' ? raw : {})
});

export const normalizeGovernancePayload = (raw = {}) => {
    const permissions = normalizeGovernancePermissions(raw.permissions);
    return {
        rule_1: raw.rule_1 != null ? String(raw.rule_1) : '',
        rule_2: raw.rule_2 != null ? String(raw.rule_2) : '',
        rule_3: raw.rule_3 != null ? String(raw.rule_3) : '',
        financial_authority: clampAuthority(raw.financial_authority, 100),
        asset_authority: clampAuthority(raw.asset_authority, 100),
        permissions
    };
};

const isGovernanceLockApproved = async (familySpaceId) => {
    const hasTable = await tableExists('sensitive_changes');
    if (hasTable) {
        const { data } = await supabase
            .from('sensitive_changes')
            .select('id')
            .eq('family_space_id', familySpaceId)
            .eq('change_type', 'Governance Lock')
            .eq('status', 'approved')
            .limit(1);
        return Boolean(data?.length);
    }
    const db = readJsonDb();
    return (db.sensitive_changes || []).some(
        (c) =>
            c.family_space_id === familySpaceId
            && c.change_type === 'Governance Lock'
            && c.status === 'approved'
    );
};

export const assertGovernanceUnlocked = async (familySpaceId) => {
    if (await isGovernanceLockApproved(familySpaceId)) {
        const err = new Error(
            'Governance Lock is enabled. Policy changes require Council unlock before they can be applied.'
        );
        err.status = 403;
        err.isGovernanceLocked = true;
        throw err;
    }
};

export const assertFamilyMembership = async (userId, familySpaceId, allowedRoles = null) => {
    if (!userId || !familySpaceId) {
        const err = new Error('Family membership required');
        err.status = 400;
        throw err;
    }
    const { data } = await supabase
        .from('family_memberships')
        .select('role')
        .eq('family_space_id', familySpaceId)
        .eq('user_id', userId)
        .maybeSingle();

    if (!data) {
        const err = new Error('You are not a member of this family space');
        err.status = 403;
        throw err;
    }
    const role = normalizeFamilyRole(data.role);
    if (allowedRoles?.length) {
        const allowed = allowedRoles.map(normalizeFamilyRole);
        if (!allowed.includes(role) && role !== 'owner') {
            // owner always allowed when owner/admin gate
            if (!(allowed.includes('owner') && role === 'owner')) {
                const err = new Error('Insufficient family role for this governance action');
                err.status = 403;
                throw err;
            }
        }
        // Special: allow family-admin when list includes admin/family-admin
        if (
            !allowed.includes(role)
            && !(role === 'family-admin' && allowed.some((r) => r === 'family-admin' || r === 'admin'))
            && role !== 'owner'
        ) {
            const err = new Error('Only Family Owner (or permitted Admin) can modify governance policies');
            err.status = 403;
            throw err;
        }
    }
    return role;
};

/** Load governance for a family — table first, then settings blob / JSON fallback */
export const loadFamilyGovernance = async (familySpaceId) => {
    const hasTable = await tableExists('family_governance');
    if (hasTable) {
        const { data, error } = await supabase
            .from('family_governance')
            .select('*')
            .eq('family_space_id', familySpaceId)
            .maybeSingle();
        if (!error && data) {
            return {
                ...normalizeGovernancePayload(data),
                id: data.id,
                family_space_id: familySpaceId,
                source: 'table'
            };
        }
    }

    const { data: space } = await supabase
        .from('family_spaces')
        .select('settings')
        .eq('id', familySpaceId)
        .maybeSingle();
    if (space?.settings?.governance_policy) {
        return {
            ...normalizeGovernancePayload(space.settings.governance_policy),
            family_space_id: familySpaceId,
            source: 'settings'
        };
    }

    const db = readJsonDb();
    const fromJson = (db.family_governance || []).find((g) => g.family_space_id === familySpaceId);
    if (fromJson) {
        return {
            ...normalizeGovernancePayload(fromJson),
            family_space_id: familySpaceId,
            source: 'json'
        };
    }

    return {
        ...normalizeGovernancePayload(DEFAULT_GOVERNANCE),
        family_space_id: familySpaceId,
        source: 'defaults'
    };
};

export const saveFamilyGovernance = async (familySpaceId, payload, actorId) => {
    const next = normalizeGovernancePayload(payload);
    const hasTable = await tableExists('family_governance');

    if (hasTable) {
        const { data, error } = await supabase
            .from('family_governance')
            .upsert(
                {
                    family_space_id: familySpaceId,
                    ...next,
                    updated_at: new Date().toISOString(),
                    updated_by: actorId || null
                },
                { onConflict: 'family_space_id' }
            )
            .select()
            .single();
        if (!error && data) {
            return { ...normalizeGovernancePayload(data), id: data.id, family_space_id: familySpaceId, source: 'table' };
        }
        // fall through on schema mismatch
        console.warn('[saveFamilyGovernance] table upsert failed:', error?.message);
    }

    // Persist into family_spaces.settings.governance_policy (merge-safe)
    const { data: space } = await supabase
        .from('family_spaces')
        .select('settings')
        .eq('id', familySpaceId)
        .maybeSingle();
    const settings = { ...(space?.settings || {}), governance_policy: next };
    const { error: spaceErr } = await supabase
        .from('family_spaces')
        .update({ settings, updated_at: new Date().toISOString() })
        .eq('id', familySpaceId);

    if (!spaceErr) {
        return { ...next, family_space_id: familySpaceId, source: 'settings' };
    }

    const db = readJsonDb();
    db.family_governance = db.family_governance || [];
    const idx = db.family_governance.findIndex((g) => g.family_space_id === familySpaceId);
    const row = { family_space_id: familySpaceId, ...next, updated_at: new Date().toISOString() };
    if (idx >= 0) db.family_governance[idx] = { ...db.family_governance[idx], ...row };
    else db.family_governance.push(row);
    writeJsonDb(db);
    return { ...next, family_space_id: familySpaceId, source: 'json' };
};

export const getGovernancePermissions = async (familySpaceId) => {
    const gov = await loadFamilyGovernance(familySpaceId);
    return gov.permissions || DEFAULT_GOVERNANCE_PERMISSIONS;
};

/** True if demoting family-admin/co-admin is blocked by policy */
export const shouldBlockAdminDemotion = (permissions, previousRole, newRole) => {
    if (permissions?.demoteAdmins !== false) return false;
    const prev = normalizeFamilyRole(previousRole);
    const next = normalizeFamilyRole(newRole);
    const prevIsAdmin = prev === 'family-admin' || prev === 'co-admin' || prev === 'admin';
    if (!prevIsAdmin) return false;
    const prevLevel = FAMILY_ROLE_META[prev]?.level ?? 9;
    const nextLevel = FAMILY_ROLE_META[next]?.level ?? 9;
    return nextLevel > prevLevel; // higher level number = lower authority
};
