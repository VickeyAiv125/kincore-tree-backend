import { supabase } from '../config/supabaseClient.js';
import { normalizeFamilyRole } from '../utils/familyRolePolicy.js';

/**
 * Middleware to enforce Platform-wide Admin roles.
 * Supports: super_admin, owner, council, business, devops, auditor.
 */
export const requirePlatformRole = (allowedRoles) => {
    return async (req, res, next) => {
        try {
            const { user } = req;
            if (!user) return res.status(401).json({ error: 'Unauthorized' });

            const { data: adminRecord, error } = await supabase
                .from('admin_users')
                .select('role')
                .eq('user_id', user.id)
                .maybeSingle();  // ✅ use maybeSingle() — returns null if not found (no error)

            let role = adminRecord?.role;
            // console.log(">>> [RBAC] user object:", user);

            // OVERRIDE: Check predefined admins if not in DB
            if (!role && user.email) {
                const DEFAULT_ADMINS = {
                    'family@admin.com': 'superadmin',
                    'owner@admin.com': 'owner',
                    'council@admin.com': 'council',
                    'branch@admin.com': 'branch-admin',
                    'business@admin.com': 'business',
                    'devops@admin.com': 'devops',
                    'auditor@admin.com': 'auditor'
                };
                role = DEFAULT_ADMINS[user.email.toLowerCase()];
            }

            if (!role) {
                // FALLBACK: Check if user has scoped staff/membership role allowing council or branch access
                const { data: staffRoles } = await supabase
                    .from('family_space_staff')
                    .select('role')
                    .eq('user_id', user.id);
                const { data: memRoles } = await supabase
                    .from('family_memberships')
                    .select('role')
                    .eq('user_id', user.id);

                const allRoles = [...(staffRoles || []), ...(memRoles || [])].map(r => r.role?.toLowerCase()).filter(Boolean);
                if (allowedRoles.includes('council') && allRoles.some(r => ['council', 'council-admin', 'editor', 'owner', 'family-admin'].includes(r))) {
                    req.adminRole = 'council';
                    return next();
                }
                if (allowedRoles.includes('branch-admin') && allRoles.some(r => ['branch-admin', 'branch admin', 'owner', 'family-admin'].includes(r))) {
                    req.adminRole = 'branch-admin';
                    return next();
                }
                return res.status(403).json({ error: 'Access denied. Platform Admin role required.' });
            }

            if (!allowedRoles.includes(role)) {
                console.log(`>>> [RBAC] Role '${role}' not in allowed: ${allowedRoles}`);
                return res.status(403).json({ error: `Access denied. Requires one of: ${allowedRoles.join(', ')}` });
            }

            req.adminRole = role;
            next();
        } catch (err) {
            res.status(500).json({ error: 'RBAC Verification Failed' });
        }
    };
};

/**
 * Middleware to enforce Family-specific roles.
 * Supports: owner, admin, member, branch-admin.
 */
export const requireFamilyRole = (familyIdParam, allowedRoles) => {
    return async (req, res, next) => {
        try {
            const { user } = req;
            let familySpaceId = req.params?.[familyIdParam] || req.body?.[familyIdParam] || req.query?.[familyIdParam];

            // OVERRIDE: Allow platform admins to bypass family role checks
            const DEFAULT_ADMINS = {
                'family@admin.com': 'super_admin',
                'owner@admin.com': 'owner',
                'council@admin.com': 'council',
                'business@admin.com': 'business',
                'devops@admin.com': 'devops'
            };
            if (user.email && DEFAULT_ADMINS[user.email.toLowerCase()]) {
                req.familyRole = 'owner';
                req.adminRole = DEFAULT_ADMINS[user.email.toLowerCase()];
                return next();
            }

            // SMART FALLBACK: If placeholder ID, fetch the user's primary family space
            const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(familySpaceId);
            if (!isUuid || familySpaceId === 'DEFAULT_FAMILY_ID' || familySpaceId === 'null' || familySpaceId === 'undefined') {
                const { data: mySpaces } = await supabase
                    .from('family_memberships')
                    .select('family_space_id, role')
                    .eq('user_id', user.id);

                if (mySpaces?.length > 0) {
                    const bestMatch = mySpaces.find(m => m.role === 'owner') || mySpaces[0];
                    familySpaceId = bestMatch?.family_space_id;
                    if (familySpaceId) {
                        console.log(`>>> [RBAC_FALLBACK] User: ${user.id} routed to space: ${familySpaceId}`);
                    }
                }

                if (!familySpaceId) {
                    const { data: firstFam } = await supabase.from('family_spaces').select('id').limit(1).maybeSingle();
                    if (firstFam) familySpaceId = firstFam.id;
                }
            }

            // FIRST: Check if the space is suspended and check its visibility
            const { data: spaceData, error: spaceError } = await supabase
                .from('family_spaces')
                .select('status, visibility')
                .eq('id', familySpaceId)
                .maybeSingle();
                
            if (spaceData?.status === 'suspended') {
                return res.status(403).json({ error: 'This Family Space has been suspended by an administrator.' });
            }

            const { data: membership, error } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('family_space_id', familySpaceId)
                .eq('user_id', user.id)
                .maybeSingle(); // Changed from .single() to avoid error throw if missing

            if (error || !membership) {
                console.warn(`>>> [RBAC] No membership found for User: ${user.id} in Space: ${familySpaceId}`);
                return res.status(403).json({ error: 'Access denied. You are not a member of this family space.' });
            }

            const normalizedMembershipRole = normalizeFamilyRole(membership.role);
            const allowedNormalized = allowedRoles.map((r) => normalizeFamilyRole(r));
            if (!allowedNormalized.includes(normalizedMembershipRole)) {
                console.warn(`>>> [RBAC] Role '${membership.role}' found, but not in: ${allowedRoles}`);
                return res.status(403).json({ error: `Access denied. Requires family role: ${allowedRoles.join(', ')}` });
            }

            // ENFORCE VISIBILITY: Private spaces block normal members
            if (spaceData?.visibility === 'Private (internal only)' && normalizedMembershipRole === 'member') {
                return res.status(403).json({ error: 'This Space is Private (Internal Only). Only staff and administrators may enter.' });
            }

            req.familyRole = normalizedMembershipRole;
            req.familySpaceId = familySpaceId;
            next();
        } catch (err) {
            console.error('>>> [RBAC_CRASH] Error in requireFamilyRole:', err);
            res.status(500).json({ error: 'Family RBAC Verification Failed' });
        }
    };
};

/**
 * Middleware that identifies if a user has a platform role but DOES NOT block them.
 * Useful for routes that behave differently for admins vs regular users.
 */
export const optionalPlatformAdmin = async (req, res, next) => {
    try {
        const { user } = req;
        if (!user) return next();

        const { data: adminRecord } = await supabase
            .from('admin_users')
            .select('role')
            .eq('user_id', user.id)
            .maybeSingle();

        if (adminRecord) {
            req.adminRole = adminRecord.role;
        }
        next();
    } catch (err) {
        next(); // Proceed anyway
    }
};
