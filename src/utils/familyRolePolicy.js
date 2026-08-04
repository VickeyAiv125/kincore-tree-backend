/**
 * Family-space role assignment policy (PRD-aligned).
 *
 * Canonical roles stored in family_memberships.role:
 *   owner | family-admin | co-admin | branch-admin | editor | member
 *
 * "Council Elder" / "Tribe Sovereign" are UI labels for the editor role —
 * not separate backend products.
 */

export const FAMILY_ROLE_RANK = {
    owner: 100,
    'family-admin': 80,
    admin: 80,
    'co-admin': 70,
    'branch-admin': 50,
    manager: 50,
    editor: 40,
    council: 40,
    'council-admin': 40,
    member: 10
};

export const FAMILY_ROLE_META = {
    owner: { key: 'owner', label: 'Family Owner', level: 1, scope: 'Global' },
    'family-admin': { key: 'family-admin', label: 'Family Admin', level: 2, scope: 'Global' },
    'co-admin': { key: 'co-admin', label: 'Co-Admin', level: 3, scope: 'Global' },
    'branch-admin': { key: 'branch-admin', label: 'Branch Admin', level: 4, scope: 'Branch' },
    editor: { key: 'editor', label: 'Editor (Council Elder)', level: 5, scope: 'Assigned' },
    member: { key: 'member', label: 'Member', level: 9, scope: 'Personal' }
};

/** Default Owner-configurable Family Admin delegations */
export const DEFAULT_ADMIN_DELEGATIONS = {
    canModifyRoles: true,
    canAssignFamilyAdmin: false,
    canAssignCoAdmin: false,
    canAddMembers: true,
    canRemoveMembers: true,
    canModifyGovernanceRules: false
};

export const normalizeFamilyRole = (roleStr) => {
    if (!roleStr) return 'member';
    const r = String(roleStr).toLowerCase().trim().replace(/_/g, '-');

    if (r === 'owner') return 'owner';
    if (['family-admin', 'family admin', 'admin', 'family'].includes(r)) return 'family-admin';
    if (['co-admin', 'coadmin', 'co admin'].includes(r)) return 'co-admin';
    if (['branch-admin', 'branch admin', 'manager', 'branch'].includes(r)) return 'branch-admin';
    if (['editor', 'council', 'council-admin', 'council admin', 'council-elder', 'council elder'].includes(r)) {
        return 'editor';
    }
    if (r === 'member' || r === 'guest' || r === 'public') return 'member';
    return r;
};

export const roleRank = (role) => FAMILY_ROLE_RANK[normalizeFamilyRole(role)] ?? 0;

export const isOwnerRole = (role) => normalizeFamilyRole(role) === 'owner';

export const isFamilyAdminRole = (role) => {
    const n = normalizeFamilyRole(role);
    return n === 'family-admin' || n === 'co-admin';
};

export const canManageFamilyRoles = (role) => {
    const n = normalizeFamilyRole(role);
    return n === 'owner' || n === 'family-admin' || n === 'co-admin';
};

/**
 * Roles an actor may assign, given their role + Owner delegations.
 * Ownership transfer is a separate flow — never assignable here.
 */
export const getAssignableRoles = (actorRole, delegations = DEFAULT_ADMIN_DELEGATIONS) => {
    const actor = normalizeFamilyRole(actorRole);
    const d = { ...DEFAULT_ADMIN_DELEGATIONS, ...(delegations || {}) };

    if (actor === 'owner') {
        return ['family-admin', 'co-admin', 'branch-admin', 'editor', 'member'];
    }

    if (actor === 'family-admin' || actor === 'co-admin') {
        if (!d.canModifyRoles) return [];

        const roles = ['branch-admin', 'editor', 'member'];
        if (d.canAssignCoAdmin) roles.unshift('co-admin');
        if (d.canAssignFamilyAdmin && actor === 'family-admin') roles.unshift('family-admin');
        return roles;
    }

    return [];
};

/**
 * Validate a role change. Returns { ok: true, newRole } or { ok: false, error, status }.
 */
export const validateRoleAssignment = ({
    actorRole,
    actorUserId,
    targetUserId,
    targetCurrentRole,
    requestedRole,
    delegations = DEFAULT_ADMIN_DELEGATIONS
}) => {
    const actor = normalizeFamilyRole(actorRole);
    const current = normalizeFamilyRole(targetCurrentRole);
    const next = normalizeFamilyRole(requestedRole);
    const d = { ...DEFAULT_ADMIN_DELEGATIONS, ...(delegations || {}) };

    if (!requestedRole) {
        return { ok: false, status: 400, error: 'Role is required.' };
    }

    if (!Object.prototype.hasOwnProperty.call(FAMILY_ROLE_META, next)) {
        return { ok: false, status: 400, error: `Invalid family role: ${requestedRole}` };
    }

    if (next === 'owner') {
        return {
            ok: false,
            status: 403,
            error: 'Ownership cannot be assigned here. Use Initiate Global Transfer / ownership transfer.'
        };
    }

    if (!canManageFamilyRoles(actor)) {
        return { ok: false, status: 403, error: 'You do not have permission to manage family roles.' };
    }

    if (actorUserId && targetUserId && actorUserId === targetUserId && next !== current) {
        // Allow self-downgrade only for non-owners; owners must use transfer
        if (actor === 'owner') {
            return { ok: false, status: 403, error: 'Family Owner cannot change their own role here. Use ownership transfer.' };
        }
    }

    // Nobody may change or remove the Family Owner via this API
    if (current === 'owner') {
        return { ok: false, status: 403, error: 'Family Owner role cannot be changed or removed via role assignment.' };
    }

    // Family Admin / Co-Admin cannot touch targets at or above their rank
    if (actor !== 'owner') {
        if (!d.canModifyRoles) {
            return { ok: false, status: 403, error: 'Family Admin role modification is disabled by Owner governance settings.' };
        }
        if (roleRank(current) >= roleRank(actor)) {
            return { ok: false, status: 403, error: 'You cannot modify a member with equal or higher authority.' };
        }
        if (roleRank(next) >= roleRank(actor)) {
            return { ok: false, status: 403, error: 'You cannot assign a role equal to or above your own.' };
        }
    }

    const allowed = getAssignableRoles(actor, d);
    if (!allowed.includes(next)) {
        return {
            ok: false,
            status: 403,
            error: `You are not allowed to assign role "${next}". Allowed: ${allowed.join(', ') || 'none'}.`
        };
    }

    return { ok: true, newRole: next, previousRole: current };
};

export const membershipAliasesFor = (...roles) => {
    const set = new Set();
    for (const role of roles) {
        const n = normalizeFamilyRole(role);
        set.add(n);
        if (n === 'family-admin') {
            set.add('admin');
            set.add('family-admin');
            set.add('family admin');
        }
        if (n === 'branch-admin') {
            set.add('branch-admin');
            set.add('branch admin');
            set.add('manager');
        }
        if (n === 'editor') {
            set.add('editor');
            set.add('council');
            set.add('council-admin');
        }
        if (n === 'co-admin') set.add('co-admin');
        if (n === 'owner') set.add('owner');
        if (n === 'member') set.add('member');
    }
    return [...set];
};

/** Map canonical role → family_space_staff.role values used historically */
export const toStaffRole = (canonical) => {
    const n = normalizeFamilyRole(canonical);
    if (n === 'owner') return 'owner';
    if (n === 'family-admin' || n === 'co-admin') return 'admin';
    if (n === 'branch-admin') return 'manager';
    if (n === 'editor') return 'editor';
    return null;
};

export const readAdminDelegations = (spaceSettings) => ({
    ...DEFAULT_ADMIN_DELEGATIONS,
    ...(spaceSettings?.governance?.adminDelegations || {})
});
