import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';
import { EventService } from '../../services/eventService.js';
import { tableExists, readJsonDb, writeJsonDb } from '../../utils/dbHelper.js';
import crypto from 'crypto';
import { logActivity } from '../../utils/logger.js';
import {
    normalizeFamilyRole,
    validateRoleAssignment,
    getAssignableRoles,
    readAdminDelegations,
    FAMILY_ROLE_META,
    toStaffRole,
    canManageFamilyRoles
} from '../../utils/familyRolePolicy.js';
import {
    parseFamilyPrivacy,
    mergePrivacyIntoSettings,
    resolveSpaceVisibility,
    familyAllowsExternalSearch,
    getViewerVisibilityTier,
    redactPersonForViewer,
    DEFAULT_FAMILY_PRIVACY
} from '../../utils/familyPrivacyPolicy.js';
import {
    getGovernancePermissions,
    shouldBlockAdminDemotion
} from '../../utils/familyGovernancePolicy.js';
import {
    parseFamilyPlatformConfig,
    mergePlatformConfigIntoSettings,
    memberLimitForTier,
    DEFAULT_FAMILY_PLATFORM_CONFIG,
    TIMEZONE_OPTIONS,
    LANGUAGE_OPTIONS,
    AUDIT_LEVELS
} from '../../utils/familyPlatformConfig.js';

/**
 * Helper to block suspended spaces.
 */
const checkSuspension = async (id, res) => {
    const { data: spaceData } = await supabase
        .from('family_spaces')
        .select('status')
        .eq('id', id)
        .maybeSingle();

    if (spaceData?.status === 'suspended') {
        res.status(403).json({ error: 'This Family Space has been suspended by an administrator.' });
        return true;
    }
    return false;
};

/**
 * Get a specific family space.
 */
export const getFamilySpace = async (req, res) => {
    try {
        const { id } = req.params;
        if (await checkSuspension(id, res)) return;

        const { data, error } = await supabase
            .from('family_spaces')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;
        
        if (data.status === 'suspended') {
            return res.status(403).json({ error: 'This Family Space has been suspended by an administrator.' });
        }
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update family space metadata.
 * Merges `settings` JSON so privacy/governance keys are not wiped.
 */
export const updateFamilySpace = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };
        const { user } = req;

        if (updates.settings && typeof updates.settings === 'object') {
            const { data: existing } = await supabase
                .from('family_spaces')
                .select('settings, visibility')
                .eq('id', id)
                .maybeSingle();

            const existingSettings = existing?.settings || {};
            updates.settings = {
                ...existingSettings,
                ...updates.settings
            };

            const privacy = parseFamilyPrivacy(updates.settings, existing?.visibility);
            if (
                Object.prototype.hasOwnProperty.call(req.body.settings, 'globalProfileVisibility')
                || Object.prototype.hasOwnProperty.call(req.body.settings, 'externalSearchIndexing')
            ) {
                updates.visibility = resolveSpaceVisibility(privacy);
            }
        }

        const { data, error } = await supabase
            .from('family_spaces')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        try {
            await supabase.from('audit_logs').insert({
                actor_id: user?.id || null,
                action: 'FAMILY_SETTINGS_UPDATE',
                target_type: 'family_spaces',
                target_id: id,
                ip_address: req.ip || '0.0.0.0',
                details: { family_space_id: id, updated_keys: Object.keys(updates) }
            });
        } catch (auditError) {
            console.error('Failed to log family settings update:', auditError);
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /families/:id/privacy — Owner privacy console (family-scoped).
 */
export const getFamilyPrivacy = async (req, res) => {
    try {
        const { id } = req.params;
        if (await checkSuspension(id, res)) return;

        const { data, error } = await supabase
            .from('family_spaces')
            .select('id, name, settings, visibility')
            .eq('id', id)
            .single();

        if (error) throw error;

        const privacy = parseFamilyPrivacy(data.settings, data.visibility);

        // Surface exposure mismatches as soft alerts for the Owner UI
        const { count: publicPersons } = await supabase
            .from('persons')
            .select('*', { count: 'exact', head: true })
            .eq('family_space_id', id)
            .eq('privacy_mode', 'public');

        const alerts = [];
        if (!familyAllowsExternalSearch(privacy) && (publicPersons || 0) > 0) {
            alerts.push({
                code: 'PUBLIC_PERSONS_WHILE_INDEXING_OFF',
                message: `${publicPersons} person profile(s) marked public while external indexing is off`,
                count: publicPersons
            });
        }
        if (privacy.dnaDataAccess) {
            alerts.push({
                code: 'DNA_ACCESS_ENABLED',
                message: 'DNA data access is enabled for this family space',
                count: 1
            });
        }

        res.json({
            family_space_id: id,
            family_name: data.name,
            visibility: data.visibility,
            privacy,
            alerts,
            defaults: DEFAULT_FAMILY_PRIVACY
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * PUT /families/:id/privacy — merge-safe privacy update + visibility sync + audit.
 */
export const updateFamilyPrivacy = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;
        if (await checkSuspension(id, res)) return;

        const patch = req.body?.privacy || req.body || {};

        const { data: existing, error: fetchError } = await supabase
            .from('family_spaces')
            .select('settings, visibility')
            .eq('id', id)
            .single();

        if (fetchError) throw fetchError;

        const nextSettings = mergePrivacyIntoSettings(existing.settings || {}, patch);
        const privacy = parseFamilyPrivacy(nextSettings, existing.visibility);
        // Always sync visibility from indexing / global profile flags after Owner privacy save
        const visibility = resolveSpaceVisibility(privacy);

        const { data, error } = await supabase
            .from('family_spaces')
            .update({
                settings: nextSettings,
                visibility,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select('id, settings, visibility')
            .single();

        if (error) throw error;

        await supabase.from('audit_logs').insert({
            actor_id: user?.id || null,
            action: 'FAMILY_PRIVACY_UPDATE',
            target_type: 'family_spaces',
            target_id: id,
            details: {
                family_space_id: id,
                privacy: parseFamilyPrivacy(data.settings, data.visibility),
                previous_visibility: existing.visibility,
                visibility
            }
        });

        res.json({
            message: 'Privacy settings updated',
            privacy: parseFamilyPrivacy(data.settings, data.visibility),
            visibility: data.visibility
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /families/:id/platform-config — family timezone / language / notifications / audit level.
 */
export const getFamilyPlatformConfig = async (req, res) => {
    try {
        const { id } = req.params;
        if (await checkSuspension(id, res)) return;

        const { data, error } = await supabase
            .from('family_spaces')
            .select('id, name, settings, subscription_tier')
            .eq('id', id)
            .single();

        if (error) throw error;

        const config = parseFamilyPlatformConfig(data.settings);

        res.json({
            family_space_id: id,
            family_name: data.name,
            config,
            defaults: DEFAULT_FAMILY_PLATFORM_CONFIG,
            options: {
                timezones: TIMEZONE_OPTIONS,
                languages: LANGUAGE_OPTIONS,
                audit_levels: AUDIT_LEVELS
            },
            member_limit: memberLimitForTier(data.subscription_tier)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * PUT /families/:id/platform-config — merge-safe platform config update + audit.
 */
export const updateFamilyPlatformConfig = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;
        if (await checkSuspension(id, res)) return;

        const patch = req.body?.config || req.body || {};

        const { data: existing, error: fetchError } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', id)
            .single();

        if (fetchError) throw fetchError;

        let nextSettings;
        try {
            nextSettings = mergePlatformConfigIntoSettings(existing.settings || {}, patch);
        } catch (validationErr) {
            return res.status(400).json({ error: validationErr.message });
        }

        const { data, error } = await supabase
            .from('family_spaces')
            .update({
                settings: nextSettings,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select('id, settings')
            .single();

        if (error) throw error;

        const config = parseFamilyPlatformConfig(data.settings);

        await supabase.from('audit_logs').insert({
            actor_id: user?.id || null,
            action: 'FAMILY_PLATFORM_CONFIG_UPDATE',
            target_type: 'family_spaces',
            target_id: id,
            details: { family_space_id: id, config }
        });

        res.json({
            message: 'Platform configuration updated',
            config
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * List all family spaces (User's spaces).
 */
export const listFamilySpaces = async (req, res) => {
    try {
        const { user } = req;
        const { data, error } = await supabase
            .from('family_memberships')
            .select(`
                family_space_id,
                role,
                family_spaces (*)
            `)
            .eq('user_id', user.id);

        if (error) throw error;
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new family space and set creator as owner.
 */
export const createFamilySpace = async (req, res) => {
    try {
        const { name, description, code, subscription_tier, storage_quota_bytes } = req.body;
        const { user } = req;

        if (!name) return res.status(400).json({ error: 'Family Space Name is required' });

        // Ensure user exists in local users table (prevents FK constraint error)
        await supabase.from('users').upsert({
            id: user.id,
            email: user.email,
            first_name: user.user_metadata?.first_name || '',
            last_name: user.user_metadata?.last_name || '',
            status: 'active'
        }, { onConflict: 'id' });

        // 1. Upload Space Photo if provided (Upload Space Photo button on screen)
        let cover_image = null;
        if (req.file) {
            const ext = req.file.originalname.split('.').pop().toLowerCase();
            const path = `space-covers/${user.id}-${Date.now()}.${ext}`;
            cover_image = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype);
        }


        // Check for Manual Approval Mode
        const { data: config } = await supabase
            .from('system_configs')
            .select('value')
            .eq('key', 'MANUAL_APPROVAL_MODE')
            .single();
        
        const isManualApproval = config?.value === 'true' || config?.value === true || config?.value === '"true"';
        
        // Also check if user is a business admin to bypass
        const { data: adminCheck } = await supabase
            .from('admin_users')
            .select('role')
            .eq('user_id', user.id)
            .in('role', ['platform-admin', 'business-admin'])
            .single();
            
        const isBusinessAdmin = !!adminCheck;

        const initialStatus = (isManualApproval && !isBusinessAdmin) ? 'pending' : 'active';

        // 2. Create Space
        const { data: space, error: spaceError } = await supabase
            .from('family_spaces')
            .insert({
                name,
                description: description || null,
                code: code || `FAM-${Math.random().toString(36).substring(7).toUpperCase()}`,
                cover_image,
                owner_id: user.id,
                subscription_tier: subscription_tier || 'free',
                storage_quota_bytes: storage_quota_bytes || 524288000, // default 500MB
                status: initialStatus
            })
            .select()
            .single();

        if (spaceError) throw spaceError;

        // 3. Set creator as Family Space Owner immediately upon creation
        const { error: membershipError } = await supabase.from('family_memberships').upsert({
            family_space_id: space.id,
            user_id: user.id,
            role: 'owner'
        }, { onConflict: 'family_space_id,user_id' });
        if (membershipError) {
            await supabase.from('family_spaces').delete().eq('id', space.id);
            throw membershipError;
        }

        // 4. Add creator to the persons table (family tree) as the root ancestor immediately upon creation
        const { data: rootPerson, error: rootPersonError } = await supabase.from('persons').insert({
            family_space_id: space.id,
            first_name: user.user_metadata?.first_name || 'Family',
            last_name: user.user_metadata?.last_name || 'Creator',
            full_name: `${user.user_metadata?.first_name || 'Family'} ${user.user_metadata?.last_name || 'Creator'}`.trim(),
            email: user.email,
            claimed_by: user.id,
            role: 'Root Ancestor',
            gender: 'other',
            status: 'active',
            privacy_mode: 'public'
        }).select('id').single();
        if (rootPersonError) {
            // Deleting the space also removes its owner membership through FK cascades.
            await supabase.from('family_spaces').delete().eq('id', space.id);
            throw rootPersonError;
        }

        if (initialStatus === 'pending') {
            try {
                const { data: businessAdmins } = await supabase
                    .from('admin_users')
                    .select('user_id')
                    .in('role', ['business-admin', 'platform-admin', 'business', 'super_admin']);
                
                if (businessAdmins && businessAdmins.length > 0) {
                    const uniqueAdmins = [...new Set(businessAdmins.map(a => a.user_id))];
                    const notificationsToInsert = uniqueAdmins.map(adminId => ({
                        user_id: adminId,
                        type: 'INFO',
                        title: 'New Family Space Request',
                        message: `User requested to create space '${name}'. Review required.`,
                        notification_metadata: { target: 'space_requests', space_id: space.id }
                    }));
                    await supabase.from('notifications').insert(notificationsToInsert);
                }
            } catch (err) {
                console.error('Failed to notify business admins:', err);
            }

            return res.status(202).json({ 
                ...space,
                role: 'owner',
                person_id: rootPerson.id,
                target_person_id: rootPerson.id,
                message: 'Your request has been sent to the Business Admin for review.',
                pending: true 
            });
        }

        res.status(201).json({
            ...space,
            role: 'owner',
            person_id: rootPerson.id,
            target_person_id: rootPerson.id
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Find Yourself — search for yourself as a Person in any family space.
 * Screen: "Find Yourself" (option 2 of "Join Existing Space" flow)
 * Returns matching persons + the family space they belong to.
 * User can then request to join that family space.
 *
 * Query params (all optional, at least 1 required):
 *   first_name, last_name, gender, dob (YYYY-MM-DD), year_only (true/false)
 */
export const findYourself = async (req, res) => {
    try {
        const { first_name, last_name, gender, dob, year_only } = req.query;

        if (!first_name && !last_name && !gender && !dob) {
            return res.status(400).json({ error: 'Enter at least one field to search.' });
        }

        let query = supabase
            .from('persons')
            .select(`
                id,
                full_name,
                gender,
                birth_date,
                bio,
                avatar_url,
                privacy_mode,
                clan_trees (
                    id,
                    name,
                    family_space_id,
                    family_spaces (
                        id,
                        name,
                        code,
                        description
                    )
                )
            `)
            .neq('privacy_mode', 'private')   // only searchable persons
            .is('claimed_by', null);           // only unclaimed (available to find)

        if (first_name) query = query.ilike('full_name', `%${first_name}%`);
        if (last_name) query = query.ilike('full_name', `%${last_name}%`);
        if (gender) query = query.eq('gender', gender.toLowerCase());

        if (dob) {
            if (year_only === 'true') {
                const year = new Date(dob).getFullYear();
                query = query.gte('birth_date', `${year}-01-01`).lte('birth_date', `${year}-12-31`);
            } else {
                query = query.eq('birth_date', dob);
            }
        }

        const { data, error } = await query.limit(20);
        if (error) throw error;

        // Enforce family-level external search / global profile flags (batch)
        const spaceIds = [...new Set(
            (data || [])
                .map((p) => p.clan_trees?.family_spaces?.id || p.clan_trees?.family_space_id)
                .filter(Boolean)
        )];
        const privacyBySpace = {};
        if (spaceIds.length) {
            const { data: spaces } = await supabase
                .from('family_spaces')
                .select('id, settings, visibility')
                .in('id', spaceIds);
            for (const s of spaces || []) {
                privacyBySpace[s.id] = parseFamilyPrivacy(s.settings, s.visibility);
            }
        }

        const results = (data || []).filter((person) => {
            const sid = person.clan_trees?.family_spaces?.id || person.clan_trees?.family_space_id;
            if (!sid) return true;
            const privacy = privacyBySpace[sid];
            if (!privacy) return true;
            return familyAllowsExternalSearch(privacy);
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json({ results, count: results.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


/**
 * Join a family space via an invitation LINK (URL).
 * Screen: "Join via Link" — user pastes full URL like:
 * https://kincore.app/join/FAM-ABC123
 * or just the code: FAM-ABC123
 */
export const joinViaLink = async (req, res) => {
    try {
        const { link } = req.body;
        const { user } = req;

        if (!link) return res.status(400).json({ error: 'Invitation link is required' });

        // Extract code from URL or use as-is if it's just a code
        let code = link.trim();
        try {
            const url = new URL(link);
            // Support: /join/FAM-ABC123 or ?code=FAM-ABC123
            const pathParts = url.pathname.split('/');
            code = pathParts[pathParts.length - 1] || url.searchParams.get('code') || code;
        } catch {
            // Not a URL — treat raw input as the code directly
        }

        // Find the space by code
        const { data: space, error: spaceError } = await supabase
            .from('family_spaces')
            .select('id, name')
            .eq('code', code.toUpperCase())
            .maybeSingle();

        if (spaceError) throw spaceError;
        if (!space) return res.status(404).json({ error: 'Invalid or expired invitation link' });

        // Check if already a member
        const { data: existing } = await supabase
            .from('family_memberships')
            .select('id')
            .eq('family_space_id', space.id)
            .eq('user_id', user.id)
            .maybeSingle();

        if (existing) {
            return res.status(409).json({
                error: 'You are already a member of this space',
                space_id: space.id,
                family_space_id: space.id,
                family_name: space.name,
            });
        }

        // Add as member
        await supabase.from('family_memberships').insert({
            family_space_id: space.id,
            user_id: user.id,
            role: 'member'
        });

        res.json({
            message: `Successfully joined "${space.name}"`,
            space_id: space.id,
            family_space_id: space.id,
            family_name: space.name,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


const buildInvitePayload = (code, familySpaceId, name = null) => {
    const inviteCode = String(code || '').toUpperCase();
    const webBase = (
        process.env.LANDING_URL
        || process.env.INVITE_WEB_BASE_URL
        || 'https://uat.kincore.com'
    ).replace(/\/$/, '');
    return {
        invite_code: inviteCode,
        family_space_id: familySpaceId,
        family_name: name,
        invite_url: `${webBase}/join/${inviteCode}`,
        deep_link: `kincore://join/${inviteCode}`,
    };
};

/**
 * Get current invite code + share URLs (does NOT rotate).
 * GET /api/families/:id/invite
 */
export const getInvite = async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('family_spaces')
            .select('id, name, code')
            .eq('id', id)
            .single();

        if (error) throw error;
        if (!data?.code) {
            return res.status(404).json({ error: 'No invite code on this family space yet. Generate one first.' });
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.json(buildInvitePayload(data.code, data.id, data.name));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Rotate invite code for the space (breaks old QR / links).
 * POST /api/families/:id/invite
 * Body optional: { rotate: true } — always rotates on POST for explicit "Generate new code".
 */
export const inviteMember = async (req, res) => {
    try {
        const { id } = req.params;
        const newCode = `INV-${Math.random().toString(36).substring(7).toUpperCase()}`;

        const { data, error } = await supabase
            .from('family_spaces')
            .update({ code: newCode })
            .eq('id', id)
            .select('id, name, code')
            .single();

        if (error) throw error;
        res.json({
            ...buildInvitePayload(data.code, data.id, data.name),
            rotated: true,
            message: 'Invite code regenerated. Previous links and QR codes stop working.',
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete a family space (Owner only).
 */
export const deleteFamilySpace = async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase
            .from('family_spaces')
            .update({ status: 'deleted' })
            .eq('id', id);

        if (error) throw error;
        
        try {
            await supabase.from('audit_logs').insert({
                actor_id: req.user?.id || null,
                action: 'FAMILY_SETTINGS_UPDATE',
                target_type: 'family_spaces',
                target_id: id,
                ip_address: req.ip || '0.0.0.0',
                details: { family_space_id: id, status: 'deleted' }
            });
        } catch (auditError) {}

        res.json({ message: 'Family space archived/deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * List members of a family space.
 */
export const getMembers = async (req, res) => {
    try {
        let { id } = req.params;
        const { user } = req;

        // 0. Hardened Family ID Resolution
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
        if (!isUuid || id === 'DEFAULT_FAMILY_ID') {
            // Priority 1: Check what space the user is currently "in"
            const { data: myMemberships } = await supabase
                .from('family_memberships')
                .select('family_space_id, role')
                .eq('user_id', user.id);

            if (myMemberships?.length > 0) {
                // Prefer the space where they are owner, otherwise the first one
                const preferOwner = myMemberships.find(m => m.role === 'owner');
                id = preferOwner ? preferOwner.family_space_id : myMemberships[0].family_space_id;
            } else {
                // Absolute Fallback: Global first space (mostly for fresh devs)
                const { data: firstFam } = await supabase.from('family_spaces').select('id').limit(1).maybeSingle();
                if (firstFam) id = firstFam.id;
            }
        }

        console.log(`>>> [GET_MEMBERS] Fetching for space: ${id}`);
        
        // CHECK SUSPENSION STATUS FIRST
        const { data: spaceData } = await supabase
            .from('family_spaces')
            .select('status')
            .eq('id', id)
            .maybeSingle();

        if (spaceData?.status === 'suspended') {
            return res.status(403).json({ error: 'This Family Space has been suspended by an administrator.' });
        }

        // 1. Fetch account memberships (Accountable Digital Identities)
        const { data: accounts, error: aError } = await supabase
            .from('family_memberships')
            .select(`
                user_id,
                role,
                status,
                joined_at,
                branch_id,
                branch:branch_id(name),
                users:user_id (*)
            `)
            .eq('family_space_id', id);

        if (aError) throw aError;
        console.log(`>>> [GET_MEMBERS] Found ${accounts?.length || 0} account memberships.`);

        // 2. Fetch all tree-linked nodes (Genealogical Person Nodes)
        // Discovery Level A: Trees
        const { data: trees } = await supabase
            .from('clan_trees')
            .select('id')
            .eq('family_space_id', id);
        const treeIds = trees?.map(t => t.id) || [];

        // Discovery Level B: Branches
        const { data: branches } = await supabase
            .from('family_branches')
            .select('id')
            .eq('family_space_id', id);
        const branchIds = branches?.map(b => b.id) || [];

        // Discovery Level C: Direct Space Tags
        const { data: taggedPersons } = await supabase
            .from('persons')
            .select('*, branch:branch_id(name)')
            .eq('family_space_id', id);

        // Fetch persons via Tree Linkage
        const { data: treePersons } = treeIds.length > 0
            ? await supabase.from('persons').select('*, branch:branch_id(name)').in('clan_tree_id', treeIds)
            : { data: [] };

        // Fetch persons via Branch Association
        const { data: branchPersons } = branchIds.length > 0
            ? await supabase.from('persons').select('*, branch:branch_id(name)').in('branch_id', branchIds)
            : { data: [] };

        // Discovery Level D: Halo Discovery (Relatives of found persons)
        // First, merge the direct nodes
        const baseMap = new Map();
        (treePersons || []).forEach(p => baseMap.set(p.id, p));
        (branchPersons || []).forEach(p => baseMap.set(p.id, p));
        (taggedPersons || []).forEach(p => baseMap.set(p.id, p));

        const baseIds = Array.from(baseMap.keys());
        let finalPersons = Array.from(baseMap.values());

        if (baseIds.length > 0) {
            // Find all relationships where these people are involved
            const { data: relationships } = await supabase
                .from('person_relations')
                .select('person_id_1, person_id_2')
                .or(`person_id_1.in.(${baseIds.join(',')}),person_id_2.in.(${baseIds.join(',')})`);

            if (relationships?.length > 0) {
                const relativeIds = new Set();
                relationships.forEach(r => {
                    if (!baseMap.has(r.person_id_1)) relativeIds.add(r.person_id_1);
                    if (!baseMap.has(r.person_id_2)) relativeIds.add(r.person_id_2);
                });

                if (relativeIds.size > 0) {
                    const { data: relatives } = await supabase
                        .from('persons')
                        .select('*, branch:branch_id(name)')
                        .in('id', Array.from(relativeIds));

                    (relatives || []).forEach(p => baseMap.set(p.id, p));
                }
            }
            finalPersons = Array.from(baseMap.values());
        }

        // Discovery Level E: Relationship-Linked Persons (Universal Bonds)
        // Fetches everyone who is part of a relationship documented in this space
        const { data: spaceBonds } = await supabase
            .from('person_relations')
            .select('person_id_1, person_id_2')
            .eq('family_space_id', id);

        if (spaceBonds?.length > 0) {
            const bondIds = new Set();
            spaceBonds.forEach(r => {
                bondIds.add(r.person_id_1);
                bondIds.add(r.person_id_2);
            });

            const uniqueBondIds = Array.from(bondIds).filter(bid => !baseMap.has(bid));
            if (uniqueBondIds.length > 0) {
                const { data: bonded } = await supabase
                    .from('persons')
                    .select('*, branch:branch_id(name)')
                    .in('id', uniqueBondIds);
                (bonded || []).forEach(p => baseMap.set(p.id, p));
            }
            finalPersons = Array.from(baseMap.values());
        }

        console.log(`>>> [GET_MEMBERS] Space: ${id} | Total Unified Population: ${finalPersons.length}`);

        // 3. Fetch Custom Roles
        const { data: customLabels } = await supabase
            .from('family_custom_labels')
            .select('role_key, custom_label')
            .eq('family_space_id', id);

        const labelMap = {};
        (customLabels || []).forEach(cl => {
            labelMap[cl.role_key.toLowerCase().replace(/\s+/g, '_')] = cl.custom_label;
        });

        // 4. Merge Logic: Digital Accounts + Phantom Nodes
        const merged = [
            ...(accounts || []).map(a => {
                const roleKey = (a.role || 'member').toLowerCase().replace(/\s+/g, '_');
                return {
                    id: a.user_id,
                    type: 'account',
                    name: `${a.users?.first_name || ''} ${a.users?.last_name || ''}`.trim() || a.users?.email || `User (${a.user_id.substring(0, 5)})`,
                    email: a.users?.email || '',
                    branch: a.branch?.name || '-',
                    role: labelMap[roleKey] || a.role || 'Member',
                    status: (a.status || 'active').charAt(0).toUpperCase() + (a.status || 'active').slice(1),
                    last_login: a.users?.last_login_at,
                    gender: a.users?.gender || 'other',
                    avatar_url: a.users?.avatar_url,
                    joined_at: a.joined_at,
                    added_by: a.invited_by ? 'System' : 'System' // Usually would fetch inviter's name
                };
            }),
            // Persons who haven't claimed an account (Phantom Nodes)
            ...(finalPersons || []).filter(p => !accounts.some(a => a.user_id === p.claimed_by)).map(p => {
                const roleKey = 'member';
                return {
                    id: p.id,
                    type: 'person',
                    name: (p.first_name || p.last_name) ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : p.full_name || 'Relative',
                    email: '',
                    branch: p.branch?.name || '-',
                    role: labelMap[p.role?.toLowerCase()?.replace(/\s+/g, '_')] || p.role || 'Member',
                    status: (p.status || 'active').charAt(0).toUpperCase() + (p.status || 'active').slice(1),
                    last_login: null,
                    gender: p.gender || 'other',
                    avatar_url: p.avatar_url,
                    joined_at: p.created_at,
                    added_by: 'System'
                };
            })
        ];

        console.log(`>>> [GET_MEMBERS] Final Unified Count: ${merged.length}`);

        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.json(merged);
    } catch (err) {
        console.error('>>> [GET_MEMBERS_ERROR]', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get dashboard stats for a family space.
 */
export const getFamilyDashboard = async (req, res) => {
    try {
        const { id } = req.params;
        if (await checkSuspension(id, res)) return;
        const { data: members } = await supabase.from('family_memberships').select('id, user_id, role').eq('family_space_id', id);
        const { data: trees } = await supabase.from('clan_trees').select('id').eq('family_space_id', id);

        const treeIds = trees?.map(t => t.id) || [];

        const { data: persons } = treeIds.length > 0
            ? await supabase.from('persons').select('id, claimed_by').in('clan_tree_id', treeIds)
            : { data: [] };

        const { data: taggedPersons } = await supabase.from('persons').select('id, claimed_by').eq('family_space_id', id);

        const personsMap = new Map();
        (persons || []).forEach(p => personsMap.set(p.id, p));
        (taggedPersons || []).forEach(p => personsMap.set(p.id, p));
        const finalPersons = Array.from(personsMap.values());

        const unlinkedLineageCount = finalPersons.filter(p => !members.some(m => m.user_id === p.claimed_by)).length;
        const personCount = finalPersons.length; // For governance health later

        // 3. Fetch Pending Requests (Claims)
        const { count: pendingCount } = await supabase
            .from('claims')
            .select('*', { count: 'exact', head: true })
            .eq('family_space_id', id)
            .eq('status', 'pending');

        // 4. Fetch Recent Activity
        const { data: newMembers } = await supabase
            .from('family_memberships')
            .select('joined_at, users:user_id (first_name, last_name, avatar_url)')
            .eq('family_space_id', id)
            .order('joined_at', { ascending: false })
            .limit(3);

        const { data: newLineage } = treeIds.length > 0
            ? await supabase
                .from('persons')
                .select('full_name, created_at, avatar_url')
                .in('clan_tree_id', treeIds)
                .order('created_at', { ascending: false })
                .limit(3)
            : { data: [] };

        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
        });

        // --- Calculate Governance Health ---
        let health = 50; // Every family starts with a base of 50 points

        // 1. Role Distribution (+15% max)
        const adminCount = members?.filter(m => ['owner', 'admin', 'family-admin'].includes(m.role?.toLowerCase())).length || 0;
        if (adminCount >= 2) health += 15;
        else if (adminCount === 1) health += 5;

        // 2. Claimed Ratio (+25% max)
        const { count: claimedCount } = treeIds.length > 0
            ? await supabase.from('persons').select('*', { count: 'exact', head: true }).in('clan_tree_id', treeIds).not('claimed_by', 'is', null)
            : { count: 0 };

        const totalPersons = personCount || 1;
        health += Math.round((claimedCount / totalPersons) * 25);

        // 3. Activity Bonus (+20% max)
        const activeCount = members?.filter(m => m.users?.last_login_at).length || 0;
        health += Math.round((activeCount / (members?.length || 1)) * 20);
        // 4. Cleanup & Diversity (+15% placeholder for branches/audit)
        if (trees?.length > 1) health += 10;
        if (pendingCount === 0) health += 5;

        const { count: branchCount } = await supabase.from('family_branches').select('*', { count: 'exact', head: true }).eq('family_space_id', id);

        // Privacy alerts (family-scoped): public people while indexing off, DNA enabled, recent privacy audits
        const { data: spaceMeta } = await supabase
            .from('family_spaces')
            .select('settings, visibility')
            .eq('id', id)
            .maybeSingle();
        const privacy = parseFamilyPrivacy(spaceMeta?.settings, spaceMeta?.visibility);
        const { count: publicPersonCount } = await supabase
            .from('persons')
            .select('*', { count: 'exact', head: true })
            .eq('family_space_id', id)
            .eq('privacy_mode', 'public');
        let privacyAlerts = 0;
        if (!familyAllowsExternalSearch(privacy) && (publicPersonCount || 0) > 0) {
            privacyAlerts += publicPersonCount;
        }
        if (privacy.dnaDataAccess) privacyAlerts += 1;

        res.json({
            stats: {
                total_members: (members?.length || 0) + unlinkedLineageCount,
                trees_active: branchCount || 0,
                pending_requests: pendingCount || 0,
                privacy_alerts: privacyAlerts,
                governance_health: Math.min(health, 100)
            },
            activity: {
                new_members: newMembers || [],
                new_lineage: newLineage || []
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Sync staff + admin_users mirrors after a membership role change.
 */
const syncRoleSideEffects = async ({ familySpaceId, userId, newRole, branchId = null }) => {
    const canonical = normalizeFamilyRole(newRole);
    const staffRole = toStaffRole(canonical);

    if (staffRole) {
        await supabase.from('family_space_staff').upsert({
            family_space_id: familySpaceId,
            user_id: userId,
            role: staffRole,
            is_active: true
        }, { onConflict: 'family_space_id,user_id' });

        await supabase.from('admin_users').upsert({
            user_id: userId,
            role: canonical === 'editor' ? 'council' : canonical
        }, { onConflict: 'user_id' });
    } else {
        await supabase.from('family_space_staff').delete().eq('family_space_id', familySpaceId).eq('user_id', userId);
        // Only clear admin_users if this was a family-scoped staff role (best-effort)
        await supabase.from('admin_users').delete().eq('user_id', userId).in('role', [
            'family-admin', 'admin', 'branch-admin', 'council', 'council-admin', 'editor', 'co-admin', 'manager'
        ]);
    }

    if (canonical === 'branch-admin' && branchId) {
        await supabase.from('family_branches').update({ branch_admin_id: userId }).eq('id', branchId);
    }

        await supabase
        .from('persons')
        .update({ role: canonical, pending_role: null })
        .eq('claimed_by', userId);
};

/**
 * GET role assignment policy for current actor in a family space.
 */
export const getFamilyRolePolicy = async (req, res) => {
    try {
        const familySpaceId = req.familySpaceId || req.params.id;
        const actorRole = req.familyRole || 'member';

        const { data: space } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', familySpaceId)
            .maybeSingle();

        const adminDelegations = readAdminDelegations(space?.settings);
        const assignable = getAssignableRoles(actorRole, adminDelegations);

        res.json({
            family_space_id: familySpaceId,
            actor_role: normalizeFamilyRole(actorRole),
            can_manage_roles: canManageFamilyRoles(actorRole),
            admin_delegations: adminDelegations,
            assignable_roles: assignable.map((key) => ({
                key,
                ...(FAMILY_ROLE_META[key] || { key, label: key, level: 9, scope: 'Personal' })
            })),
            all_roles: Object.values(FAMILY_ROLE_META),
            note: 'Council Elder is a UI label for the editor role. Ownership changes use transfer-ownership, not role assign.'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update member role (Family Owner / Family Admin with delegated authority).
 */
export const updateMemberRole = async (req, res) => {
    try {
        const { id, userId } = req.params;
        const { role, branch_id: branchId, notes } = req.body;
        const actor = req.user;
        const actorRole = req.familyRole || 'member';
        const familySpaceId = req.familySpaceId || id;

        const { data: space } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', familySpaceId)
            .maybeSingle();

        const adminDelegations = readAdminDelegations(space?.settings);
        const govPermissions = await getGovernancePermissions(familySpaceId);

        const { data: targetMembership, error: targetErr } = await supabase
            .from('family_memberships')
            .select('role, branch_id, user_id')
            .eq('family_space_id', familySpaceId)
            .eq('user_id', userId)
            .maybeSingle();

        if (targetErr) throw targetErr;
        if (!targetMembership) {
            return res.status(404).json({ error: 'Target member not found in this family space.' });
        }

        const validation = validateRoleAssignment({
            actorRole,
            actorUserId: actor?.id,
            targetUserId: userId,
            targetCurrentRole: targetMembership.role,
            requestedRole: role,
            delegations: adminDelegations
        });

        if (!validation.ok) {
            return res.status(validation.status || 403).json({ error: validation.error });
        }

        if (shouldBlockAdminDemotion(govPermissions, validation.previousRole, validation.newRole)) {
            return res.status(403).json({
                error: 'Governance policy blocks demoting Family Admins. Enable “Owners can demote Family Admins” in Owner Governance.'
            });
        }

        if (govPermissions.mandatory2FA && !['owner'].includes(normalizeFamilyRole(actorRole))) {
            // Soft gate: admin actors must have recent MFA marker when policy mandates it
            if (!actor?.mfa_verified_at && !req.headers['x-mfa-verified']) {
                return res.status(403).json({
                    error: 'Mandatory 2FA is enabled for administrative roles. Verify MFA then retry.',
                    requires_mfa: true
                });
            }
        }

        const newRole = validation.newRole;
        if (newRole === 'branch-admin' && !(branchId || targetMembership.branch_id)) {
            return res.status(400).json({ error: 'Branch Assignment is mandatory when assigning Branch Admin.' });
        }

        const { error } = await supabase
            .from('family_memberships')
            .update({
                role: newRole,
                ...(branchId ? { branch_id: branchId } : {})
            })
            .eq('family_space_id', familySpaceId)
            .eq('user_id', userId);

        if (error) throw error;

        await syncRoleSideEffects({
            familySpaceId,
            userId,
            newRole,
            branchId: branchId || targetMembership.branch_id
        });

        try {
            await supabase.from('audit_logs').insert({
                actor_id: actor?.id || null,
                action: 'ADMIN_ROLE_ASSIGNED',
                target_type: 'family_memberships',
                target_id: userId,
                ip_address: req.ip || '0.0.0.0',
                details: {
                    family_space_id: familySpaceId,
                    event: 'Updated Member Role',
                    previous_role: validation.previousRole,
                    new_role: newRole,
                    actor_role: normalizeFamilyRole(actorRole),
                    notes: notes || null
                }
            });
        } catch (auditError) {
            console.warn('[updateMemberRole] audit insert failed:', auditError?.message);
        }

        // Optional in-app notification
        try {
            await supabase.from('notifications').insert({
                user_id: userId,
                type: 'role_change',
                title: 'Family role updated',
                message: `Your family role was changed to ${FAMILY_ROLE_META[newRole]?.label || newRole}.`
            });
        } catch (_) { /* optional table */ }

        try {
            const { dispatchNotification } = await import('../../services/notificationService.js');
            await dispatchNotification(
                familySpaceId,
                'Role change',
                'Family role updated',
                `${FAMILY_ROLE_META[newRole]?.label || newRole} assigned (was ${validation.previousRole}).`,
                undefined,
                { channel: 'roles', extraUserIds: [userId] }
            );
        } catch (_) { /* non-blocking */ }

        res.json({
            message: 'Role updated',
            previous_role: validation.previousRole,
            new_role: newRole,
            family_space_id: familySpaceId
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Resolve a join request (claim).
 */
export const resolveJoinRequest = async (req, res) => {
    try {
        const { id, userId } = req.params; // id is family_space_id
        const { action, reason } = req.body; // approved, rejected
        const { user: actor } = req;

        if (!['approved', 'rejected'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action. Use "approved" or "rejected".' });
        }

        // 1. Find the pending membership/request
        const { data: membership, error: mError } = await supabase
            .from('family_memberships')
            .select('*')
            .eq('family_space_id', id)
            .eq('user_id', userId)
            .single();

        if (mError || !membership) return res.status(404).json({ error: 'Join request not found' });

        // 2. Update status
        const { data, error } = await supabase
            .from('family_memberships')
            .update({ 
                status: action,
                // We can store reason in a metadata field if it exists, or just in audit log
            })
            .eq('family_space_id', id)
            .eq('user_id', userId)
            .select()
            .single();

        if (error) throw error;

        // 3. Audit Log
        await supabase.from('audit_logs').insert({
            actor_id: actor.id,
            action: `JOIN_REQUEST_${action.toUpperCase()}`,
            target_type: 'family_memberships',
            target_id: data.id,
            details: { reason, family_space_id: id, user_id: userId }
        });

        // 4. Notify User
        await supabase.from('notifications').insert({
            user_id: userId,
            type: action === 'approved' ? 'request_approved' : 'request_rejected',
            title: action === 'approved' ? 'Family Request Approved' : 'Family Request Rejected',
            message: action === 'approved' 
                ? `Welcome! Your request to join the family space has been approved.`
                : `Your request to join the family space was declined. Reason: ${reason || 'No reason provided.'}`
        });

        const { dispatchNotification } = await import('../../services/notificationService.js');
        await dispatchNotification(
            id,
            'Group membership change',
            `Membership request ${action}`,
            `A join request was ${action}${reason ? `: ${reason}` : ''}.`,
            undefined,
            { extraUserIds: [userId] }
        );

        res.json({ message: `Request ${action}`, membership: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get family events.
 */
export const getFamilyEvents = async (req, res) => {
    try {
        const { id } = req.params; // family_space_id
        if (await checkSuspension(id, res)) return;
        const { filter, search } = req.query;
        const now = new Date().toISOString();

        let query = supabase
            .from('events')
            .select(`
                *,
                creator:users!events_creator_id_fkey(first_name, last_name, avatar_url),
                rsvps:event_rsvps(status, user_id, users(avatar_url)),
                family:family_spaces(name)
            `)
            .eq('family_space_id', id); // always scoped to this family

        if (filter === 'past') {
            query = query.lt('start_date', now).order('start_date', { ascending: false });
        } else if (filter === 'upcoming') {
            query = query.gte('start_date', now).order('start_date', { ascending: true });
        } else {
            // Default for owner: ALL events ordered by newest first
            query = query.order('created_at', { ascending: false });
        }

        if (search) {
            query = query.ilike('title', `%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get single event detail.
 */
export const getEventById = async (req, res) => {
    try {
        const { eventId } = req.params;
        const event = await EventService.getEventById(eventId);
        res.json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update an existing Family Event (family-scoped)
 */
export const updateEventById = async (req, res) => {
    try {
        const { eventId } = req.params;
        const event = await EventService.updateEvent(eventId, req.body, req.file || null);
        res.json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete a Family Event (family-scoped)
 */
export const deleteEventById = async (req, res) => {
    try {
        const { eventId } = req.params;
        await EventService.deleteEvent(eventId);
        res.json({ message: 'Event deleted successfully.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new Family Event
 */
export const createEvent = async (req, res) => {
    try {
        const { id } = req.params; // family_space_id
        const event = await EventService.createEvent({
            ...req.body,
            family_space_id: id,
            creator_id: req.user?.id
        }, req.file);

        res.status(201).json(event);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get a single member by ID (user_id or person_id).
 */
export const getMemberById = async (req, res) => {
    try {
        const { id, memberId } = req.params;
        const targetId = memberId || id;
        const familyId = memberId ? id : null;

        // Try finding as person first (lineage)
        let { data: person, error: pErr } = await supabase
            .from('persons')
            .select('*, branch:branch_id(name), clan_trees(family_space_id)')
            .or(`id.eq.${targetId},claimed_by.eq.${targetId}`)
            .maybeSingle();

        if (!person) {
            // Try finding as account if person not found or claimed
            let query = supabase
                .from('family_memberships')
                .select('*, users(*)')
                .eq('user_id', targetId);
            
            if (familyId) query = query.eq('family_space_id', familyId);

            const { data: member } = await query.maybeSingle();

            if (member) {
                person = {
                    id: member.user_id,
                    full_name: `${member.users.first_name} ${member.users.last_name}`.trim(),
                    email: member.users.email,
                    role: member.role,
                    status: member.status,
                    gender: member.users.gender,
                    avatar_url: member.users.avatar_url,
                    branch_id: member.branch_id,
                    family_space_id: member.family_space_id
                };
            }
        } else {
            // Merge person data with potential membership role
            person.role = person.role || 'member';
            person.branch_name = person.branch?.name || '-';
            
            // Flatten family_space_id
            // Flatten family_space_id (could be object or array depending on relation)
            if (Array.isArray(person.clan_trees)) {
                person.family_space_id = person.clan_trees[0]?.family_space_id;
            } else {
                person.family_space_id = person.clan_trees?.family_space_id;
            }
        }

        if (!person) return res.status(404).json({ error: 'Member not found' });

        // 2. Fetch Relationships with Details
        const { data: relations, error: rError } = await supabase
            .from('person_relations')
            .select(`
                relation_type,
                person_id_1,
                person_id_2,
                p1:person_id_1 (id, full_name, avatar_url, gender),
                p2:person_id_2 (id, full_name, avatar_url, gender)
            `)
            .or(`person_id_1.eq.${person.id},person_id_2.eq.${person.id}`);

        if (rError) throw rError;

        // Structure relations for the frontend
        const structured = {
            parents: [],
            children: [],
            spouse: null
        };

        relations.forEach(rel => {
            if (rel.relation_type === 'parent') {
                if (rel.person_id_1 === person.id) {
                    // Current person is parent, so p2 is child
                    structured.children.push({
                        id: rel.p2.id,
                        name: rel.p2.full_name,
                        avatar_url: rel.p2.avatar_url
                    });
                } else {
                    // Current person is child, so p1 is parent
                    structured.parents.push({
                        id: rel.p1.id,
                        name: rel.p1.full_name,
                        avatar_url: rel.p1.avatar_url,
                        gender: rel.p1.gender
                    });
                }
            } else if (rel.relation_type === 'spouse') {
                const partner = rel.person_id_1 === person.id ? rel.p2 : rel.p1;
                structured.spouse = {
                    id: partner.id,
                    name: partner.full_name,
                    avatar_url: partner.avatar_url
                };
            }
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        // Family-scoped visibility: redact sensitive fields for Limited viewers
        const spaceId = familyId || person.family_space_id;
        let viewerRole = 'member';
        let privacy = parseFamilyPrivacy({}, null);
        if (spaceId && req.user?.id) {
            const [{ data: spaceRow }, { data: membership }] = await Promise.all([
                supabase.from('family_spaces').select('settings, visibility').eq('id', spaceId).maybeSingle(),
                supabase.from('family_memberships').select('role').eq('family_space_id', spaceId).eq('user_id', req.user.id).maybeSingle()
            ]);
            privacy = parseFamilyPrivacy(spaceRow?.settings, spaceRow?.visibility);
            viewerRole = membership?.role || 'member';
        }
        const tier = getViewerVisibilityTier(viewerRole, privacy);
        const safePerson = redactPersonForViewer(person, { tier, privacy });

        // Lineage visibility off → hide relationship tree for non-admins
        const relationshipsOut = (!privacy.lineageVisibility && tier !== 'Full')
            ? { parents: [], children: [], spouse: null, _hidden: true }
            : structured;

        res.json({
            ...safePerson,
            relationships: relationshipsOut,
            _privacy: { tier, sensitiveDataRedaction: privacy.sensitiveDataRedaction }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update member profile.
 */
export const updateMember = async (req, res) => {
    try {
        const { id, memberId } = req.params;
        const targetMemberId = memberId || id;
        const familyId = memberId ? id : req.body.family_id;

        const updates = req.body;

        const {
            first_name, last_name, email, gender, role, status, is_alive,
            date_of_birth, place_of_birth, bio_notes,
            visibility,
            hideBirthDate, hideLocation, hideLivingStatus, protectAsMinor
        } = updates;

        const branch_id = updates.branch_id === '' ? null : updates.branch_id;
        let inviteWarning = null;

        // Enforce role-assignment policy when a role change is requested
        let enforcedRole = role ? normalizeFamilyRole(role) : null;
        if (role && familyId && req.user?.id) {
            const { data: actorMembership } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('family_space_id', familyId)
                .eq('user_id', req.user.id)
                .maybeSingle();

            const { data: space } = await supabase
                .from('family_spaces')
                .select('settings')
                .eq('id', familyId)
                .maybeSingle();

            let targetCurrentRole = 'member';
            const claimedUserId = (await supabase
                .from('persons')
                .select('claimed_by, role')
                .or(`id.eq.${targetMemberId},claimed_by.eq.${targetMemberId}`)
                .maybeSingle()).data;

            if (claimedUserId?.claimed_by) {
                const { data: tm } = await supabase
                    .from('family_memberships')
                    .select('role')
                    .eq('family_space_id', familyId)
                    .eq('user_id', claimedUserId.claimed_by)
                    .maybeSingle();
                targetCurrentRole = tm?.role || claimedUserId.role || 'member';
            } else if (claimedUserId?.role) {
                targetCurrentRole = claimedUserId.role;
            }

            const actorRole = actorMembership?.role || 'member';
            // Owners editing person records may set roles; family admins only if delegated
            if (canManageFamilyRoles(actorRole) || normalizeFamilyRole(actorRole) === 'owner') {
                const validation = validateRoleAssignment({
                    actorRole,
                    actorUserId: req.user.id,
                    targetUserId: claimedUserId?.claimed_by || targetMemberId,
                    targetCurrentRole,
                    requestedRole: role,
                    delegations: readAdminDelegations(space?.settings)
                });
                if (!validation.ok) {
                    return res.status(validation.status || 403).json({ error: validation.error });
                }
                enforcedRole = validation.newRole;
            } else if (normalizeFamilyRole(role) !== normalizeFamilyRole(targetCurrentRole)) {
                return res.status(403).json({ error: 'You do not have permission to change member roles.' });
            }
        }

        // Handle Avatar Upload
        let avatar_url = null;
        if (req.file) {
            const ext = req.file.originalname.split('.').pop().toLowerCase();
            const path = `persons/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            avatar_url = await uploadFile(BUCKETS.AVATARS, path, req.file.buffer, req.file.mimetype);
        }

        // 1. Update the 'persons' record(s)
        const { data: persons, error: pLookupErr } = await supabase
            .from('persons')
            .select('id, claimed_by')
            .or(`id.eq.${targetMemberId},claimed_by.eq.${targetMemberId}`);

        if (pLookupErr) console.error('[UPDATE_MEMBER] Person lookup error:', pLookupErr);

        console.log(`[UPDATE_MEMBER] Editing ID: ${targetMemberId} in Space: ${familyId}`);
        console.log(`[UPDATE_MEMBER] Persons found matching ID:`, persons?.length || 0);

        if (persons && persons.length > 0) {
            for (const p of persons) {
                console.log(`[UPDATE_MEMBER] Attempting update for person record: ${p.id}`);
                
                const isUnregistered = !p.claimed_by;
                const actualRole = enforcedRole || (role ? normalizeFamilyRole(role) : null);
                let pendingRole = null;
                let memberStatus = undefined;

                if (isUnregistered) {
                    const isAdminOrEditorRole = actualRole && ['editor', 'branch-admin', 'family-admin', 'co-admin', 'owner'].includes(actualRole);
                    if (email && isAdminOrEditorRole) {
                        memberStatus = 'invitation_pending';
                        pendingRole = actualRole;

                        // Trigger Email Invite via Supabase Admin API
                        try {
                            const { error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(email, {
                                data: { 
                                    first_name: first_name || 'Member',
                                    role: pendingRole,
                                    family_space_id: familyId
                                },
                                redirectTo: `${process.env.FRONTEND_URL || 'https://kincore-tree.vercel.app'}/accept-invite`
                            });
                            if (inviteErr) {
                                console.log(`[UPDATE_MEMBER] Invite failed (${inviteErr.message}), sending OTP magic link to existing user ${email}...`);
                                const { error: otpErr } = await supabase.auth.signInWithOtp({
                                    email: email.trim(),
                                    options: {
                                        emailRedirectTo: `${process.env.FRONTEND_URL || 'https://kincore-tree.vercel.app'}/accept-invite`
                                    }
                                });
                                if (otpErr) {
                                    inviteWarning = `Could not send invite/login email to ${email}: ${otpErr.message}`;
                                } else {
                                    console.log(`[UPDATE_MEMBER] Successfully sent login magic link to ${email}`);
                                }
                            } else {
                                console.log(`[UPDATE_MEMBER] Successfully sent invite to ${email}`);
                            }
                        } catch (err) {
                            console.error(`[UPDATE_MEMBER] Exception sending invite to ${email}:`, err);
                            inviteWarning = `Exception sending invite: ${err.message}`;
                        }
                    } else {
                        memberStatus = email ? 'invitation_pending' : 'family_record_only';
                        pendingRole = actualRole || 'member';
                    }
                }

                const updatePayload = {
                    full_name: `${first_name} ${last_name}`.trim(),
                    first_name, last_name,
                    gender: gender?.toLowerCase(),
                    status: status?.toLowerCase(),
                    is_alive: String(is_alive) === 'true',
                    bio: bio_notes,
                    birth_date: date_of_birth,
                    place_of_birth,
                    branch_id,
                    email: email,
                    privacy_mode: visibility === 'Family Only' ? 'family' : visibility?.toLowerCase(),
                    hide_birth_date: hideBirthDate,
                    hide_location: hideLocation,
                    hide_living_status: hideLivingStatus,
                    protect_as_minor: protectAsMinor,
                    ...(avatar_url && { avatar_url })
                };

                if (actualRole !== null) updatePayload.role = actualRole;
                if (pendingRole !== null) updatePayload.pending_role = pendingRole;
                if (memberStatus !== undefined) updatePayload.member_status = memberStatus;

                const { error: pErr } = await supabase.from('persons').update(updatePayload).eq('id', p.id);
                if (pErr) console.error(`[UPDATE_MEMBER] Person update ERROR:`, pErr);
                else console.log(`[UPDATE_MEMBER] Person update SUCCESS`);
            }

            let linkedUserIds = new Set();
            persons.forEach(p => { if (p.claimed_by) linkedUserIds.add(p.claimed_by); });
            if (email) {
                const { data: matchedUsers } = await supabase.from('users').select('id').ilike('email', email.trim());
                if (matchedUsers) matchedUsers.forEach(u => linkedUserIds.add(u.id));
            }

            for (const userId of linkedUserIds) {
                console.log(`[UPDATE_MEMBER] Identified linked userId for membership/user update: ${userId}`);
                // Link claimed_by if not already linked
                await supabase.from('persons').update({ claimed_by: userId }).in('id', persons.map(p => p.id));

                if (familyId) {
                    const normalizedRole = enforcedRole || (role ? normalizeFamilyRole(role) : 'member');

                    const { error: mErr } = await supabase.from('family_memberships').upsert({
                        user_id: userId,
                        family_space_id: familyId,
                        role: normalizedRole,
                        status: status?.toLowerCase() || 'active',
                        branch_id: branch_id || null
                    }, { onConflict: 'user_id,family_space_id' });
                    if (mErr) {
                        console.error(`[UPDATE_MEMBER] Membership upsert ERROR (Scoped):`, mErr);
                    } else {
                        console.log(`[UPDATE_MEMBER] Membership upsert SUCCESS (Scoped) to ${normalizedRole} with branch ${branch_id}`);
                        await syncRoleSideEffects({
                            familySpaceId: familyId,
                            userId,
                            newRole: normalizedRole,
                            branchId: branch_id
                        });

                        if (email) {
                            try {
                                const { error: otpErr } = await supabase.auth.signInWithOtp({
                                    email: email.trim(),
                                    options: {
                                        emailRedirectTo: `${process.env.FRONTEND_URL || 'https://kincore-tree.vercel.app'}/accept-invite`
                                    }
                                });
                                if (otpErr) {
                                    console.log(`[UPDATE_MEMBER] Magic link notice for ${email}: ${otpErr.message}`);
                                } else {
                                    console.log(`[UPDATE_MEMBER] Successfully sent login magic link to ${email}`);
                                }
                            } catch (e) {
                                console.error(`[UPDATE_MEMBER] Magic link error:`, e);
                            }
                        }
                    }
                } else {
                    const normalizedRole = enforcedRole || (role ? normalizeFamilyRole(role) : null);
                    const { error: mErr } = await supabase.from('family_memberships').update({
                        role: normalizedRole || role?.toLowerCase(),
                        status: status?.toLowerCase(),
                        branch_id
                    }).eq('user_id', userId);
                    if (mErr) console.error(`[UPDATE_MEMBER] Membership update ERROR (Global):`, mErr);
                    else console.log(`[UPDATE_MEMBER] Membership update SUCCESS (Global)`);
                }

                const { error: uErr } = await supabase.from('users').update({
                    first_name, last_name,
                    gender: gender?.toLowerCase(),
                    status: status?.toLowerCase(),
                    bio: bio_notes,
                    date_of_birth,
                    place_of_birth,
                    hide_birth_date: hideBirthDate,
                    hide_location: hideLocation,
                    hide_living_status: hideLivingStatus,
                    protect_as_minor: protectAsMinor,
                    ...(avatar_url && { avatar_url })
                }).eq('id', userId);
                if (uErr) console.error(`[UPDATE_MEMBER] User table update ERROR:`, uErr);
                else console.log(`[UPDATE_MEMBER] User table update SUCCESS`);
            }
        } else {
            console.log(`[UPDATE_MEMBER] No linked person record found, updating raw person ID: ${targetMemberId}`);
            const { error: pErr } = await supabase.from('persons').update({
                full_name: `${first_name} ${last_name}`.trim(),
                first_name, last_name,
                gender: gender?.toLowerCase(),
                status: status?.toLowerCase(),
                is_alive: String(is_alive) === 'true',
                bio: bio_notes,
                birth_date: date_of_birth,
                place_of_birth,
                branch_id,
                role: role?.toLowerCase(),
                email: email,
                privacy_mode: visibility === 'Family Only' ? 'family' : visibility?.toLowerCase(),
                hide_birth_date: hideBirthDate,
                hide_location: hideLocation,
                hide_living_status: hideLivingStatus,
                protect_as_minor: protectAsMinor,
                ...(avatar_url && { avatar_url })
            }).eq('id', targetMemberId);
            if (pErr) console.error(`[UPDATE_MEMBER] Raw Person update ERROR:`, pErr);
            else console.log(`[UPDATE_MEMBER] Raw Person update SUCCESS`);
        }

        await logActivity(req.user?.id || targetMemberId, 'UPDATE_MEMBER', 'persons', targetMemberId, familyId, {
            role,
            status,
            branch_id,
            diff: {
                role: { old: 'previous', new: role || 'unchanged' },
                status: { old: 'previous', new: status || 'unchanged' },
                branch_id: { old: 'previous', new: branch_id || 'unassigned' }
            }
        });

        res.json({ message: 'Profile updated successfully', inviteWarning });
        if (familyId) {
            const { dispatchNotification } = await import('../../services/notificationService.js');
            dispatchNotification(
                familyId,
                'User profile update',
                'Member profile updated',
                `A family member profile was updated${email ? ` (${email})` : ''}.`
            ).catch(() => {});
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const removeMember = async (req, res) => {
    try {
        const { id, memberId } = req.params;
        const { error } = await supabase
            .from('family_memberships')
            .delete()
            .eq('family_space_id', id)
            .eq('user_id', memberId);

        if (error) throw error;
        await logActivity(req.user?.id || memberId, 'REMOVE_MEMBER', 'family_memberships', memberId, id, {
            member_id: memberId,
            diff: {
                status: { old: 'active', new: 'removed' }
            }
        });
        res.json({ message: 'Member removed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get Family Subscription details
 * GET /api/families/:id/subscription
 */
export const getFamilySubscription = async (req, res) => {
    try {
        const { id } = req.params;
        if (await checkSuspension(id, res)) return;

        const actorRole = normalizeFamilyRole(req.familyRole || 'member');
        const govPermissions = await getGovernancePermissions(id);
        const elevated = ['owner', 'family-admin', 'co-admin', 'admin'].includes(actorRole);

        const { data, error } = await supabase
            .from('family_spaces')
            .select('subscription_tier, storage_used_bytes, storage_quota_bytes')
            .eq('id', id)
            .single();

        if (error || !data) throw new Error('Could not fetch subscription details');

        // financialReports: billing history only for elevated roles or when policy grants access
        let logs = [];
        if (elevated || govPermissions.financialReports) {
            const { data: auditLogs } = await supabase
                .from('audit_logs')
                .select('created_at, details')
                .eq('target_id', id)
                .eq('action', 'subscription_change')
                .order('created_at', { ascending: false });
            logs = auditLogs || [];
        }

        const usagePercentage = data.storage_quota_bytes > 0 
            ? (Number(data.storage_used_bytes) / Number(data.storage_quota_bytes)) * 100 
            : 0;

        const member_limit = memberLimitForTier(data.subscription_tier);

        res.json({
            current_plan: data.subscription_tier,
            storage_used: Number(data.storage_used_bytes),
            storage_quota: Number(data.storage_quota_bytes),
            usage_percentage: parseFloat(usagePercentage.toFixed(2)),
            member_limit,
            billing_history: logs,
            financial_reports_allowed: elevated || !!govPermissions.financialReports
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update Family Subscription
 * PUT /api/families/:id/subscription
 */
export const updateFamilySubscription = async (req, res) => {
    try {
        const { id } = req.params;
        const { new_tier } = req.body;
        const { user } = req;

        const TIERS = {
            'free': { bytes: 524288000, price: 0 },          // 500 MB
            'standard': { bytes: 5368709120, price: 19.99 },     // 5 GB
            'premium': { bytes: 53687091200, price: 49.99 }      // 50 GB
        };

        if (!TIERS[new_tier]) {
            return res.status(400).json({ error: 'Invalid subscription tier' });
        }

        // Fetch current to log it
        const { data: current } = await supabase.from('family_spaces').select('subscription_tier').eq('id', id).single();

        const { data, error } = await supabase
            .from('family_spaces')
            .update({ 
                subscription_tier: new_tier,
                storage_quota_bytes: TIERS[new_tier].bytes 
            })
            .eq('id', id)
            .select('subscription_tier, storage_used_bytes, storage_quota_bytes')
            .single();

        if (error) throw error;

        // Log the change
        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: 'subscription_change',
            target_type: 'family_space',
            target_id: id,
            details: {
                old_tier: current?.subscription_tier,
                new_tier,
                price: TIERS[new_tier].price
            }
        });

        try {
            const { dispatchNotification } = await import('../../services/notificationService.js');
            dispatchNotification(
                id,
                'Subscription renewal',
                'Subscription updated',
                `Plan changed from ${current?.subscription_tier || 'unknown'} to ${new_tier}.`
            ).catch(() => {});
        } catch (_) { /* non-blocking */ }

        res.json({ message: 'Subscription updated successfully', subscription: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Add a new member (Lineage Person).
 */
export const addMember = async (req, res) => {
    try {
        const {
            first_name, last_name, gender, birth_date, is_alive,
            place_of_birth, bio, family_id, parentId, relType
        } = req.body;

        if (!first_name) return res.status(400).json({ error: 'First Name is required' });

        let targetFamilyId = (family_id && family_id !== 'null' && family_id !== 'undefined') ? family_id : null;
        if (!targetFamilyId && req.user?.id) {
            // Priority 1: Check if user owns a family space directly right after creation
            const { data: ownedSpace } = await supabase
                .from('family_spaces')
                .select('id')
                .or(`owner_id.eq.${req.user.id},created_by.eq.${req.user.id}`)
                .limit(1)
                .maybeSingle();
            if (ownedSpace?.id) {
                targetFamilyId = ownedSpace.id;
            }

            // Priority 2: Check family_memberships table
            if (!targetFamilyId) {
                const { data: myMembership } = await supabase
                    .from('family_memberships')
                    .select('family_space_id')
                    .eq('user_id', req.user.id)
                    .limit(1)
                    .maybeSingle();
                if (myMembership?.family_space_id) {
                    targetFamilyId = myMembership.family_space_id;
                }
            }

            // Priority 3: Check family_space_staff table
            if (!targetFamilyId) {
                const { data: staffSpace } = await supabase
                    .from('family_space_staff')
                    .select('family_space_id')
                    .eq('user_id', req.user.id)
                    .limit(1)
                    .maybeSingle();
                if (staffSpace?.family_space_id) {
                    targetFamilyId = staffSpace.family_space_id;
                }
            }

            // Priority 4: Check admin_users table
            if (!targetFamilyId) {
                const { data: adminSpace } = await supabase
                    .from('admin_users')
                    .select('family_id')
                    .eq('user_id', req.user.id)
                    .not('family_id', 'is', null)
                    .limit(1)
                    .maybeSingle();
                if (adminSpace?.family_id) {
                    targetFamilyId = adminSpace.family_id;
                }
            }
        }

        if (!targetFamilyId) return res.status(400).json({ error: 'Family ID could not be resolved. Please create or join a family space.' });

        // Handle Avatar Upload
        let avatar_url = null;
        if (req.file) {
            const ext = req.file.originalname.split('.').pop().toLowerCase();
            const path = `persons/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
            avatar_url = await uploadFile(BUCKETS.AVATARS, path, req.file.buffer, req.file.mimetype);
        }

        const { data: tree } = await supabase
            .from('clan_trees')
            .select('id')
            .eq('family_space_id', targetFamilyId)
            .limit(1)
            .maybeSingle();
        let tree_id = tree?.id;

        if (!tree_id) {
            const { data: newTree, error: treeErr } = await supabase
                .from('clan_trees')
                .insert({ family_space_id: targetFamilyId, name: 'Main Tree' })
                .select()
                .maybeSingle();
            if (treeErr || !newTree) {
                const { data: existingTree } = await supabase
                    .from('clan_trees')
                    .select('id')
                    .eq('family_space_id', targetFamilyId)
                    .limit(1)
                    .maybeSingle();
                tree_id = existingTree?.id || null;
            } else {
                tree_id = newTree.id;
            }
        }

        const { data: person, error: pErr } = await supabase.from('persons').insert({
            family_space_id: targetFamilyId,
            full_name: `${first_name} ${last_name || ''}`.trim(),
            first_name, last_name,
            gender: gender?.toLowerCase() || 'other',
            birth_date: birth_date || null,
            status: is_alive === false || is_alive === 'false' ? 'deceased' : 'active',
            place_of_birth: place_of_birth || null,
            bio: bio || null,
            avatar_url,
            clan_tree_id: tree_id
        }).select().maybeSingle();

        if (pErr) throw pErr;
        if (!person) throw new Error('Failed to create member record');

        if (parentId && relType === 'child') {
            // Resolve parentId if it's a UUID (might be person_id or user_id)
            const { data: parentPerson } = await supabase
                .from('persons')
                .select('id')
                .or(`id.eq.${parentId},claimed_by.eq.${parentId}`)
                .maybeSingle();

            const realParentId = parentPerson?.id || parentId;

            await supabase.from('person_relations').insert({
                person_id_1: realParentId,
                person_id_2: person.id,
                relation_type: 'parent',
                clan_tree_id: tree_id
            });
        }

        res.status(201).json({ message: 'Member added', person });
        if (targetFamilyId) {
            const { dispatchNotification } = await import('../../services/notificationService.js');
            dispatchNotification(
                targetFamilyId,
                'New user registration',
                'New family member added',
                `${first_name || ''} ${last_name || ''}`.trim() || 'A new member was added to the family tree.'
            ).catch(() => {});
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update relationships.
 */
export const updateRelationships = async (req, res) => {
    try {
        const { targetId, fatherId, motherId, spouseId, family_space_id, familySpaceId } = req.body;
        const spaceHint = family_space_id || familySpaceId || req.params?.id;

        const resolvePerson = async (id) => {
            if (!id || id === 'null') return null;
            const { data } = await supabase.from('persons').select('id, clan_tree_id, branch_id, family_space_id').or(`id.eq.${id},claimed_by.eq.${id}`).maybeSingle();
            return data;
        };

        const target = await resolvePerson(targetId);
        if (!target) return res.status(404).json({ error: 'Person not found to link relationships' });

        const personId = target.id;
        const clan_tree_id = target.clan_tree_id;

        // Resolve family space for governance
        let familySpaceIdResolved = spaceHint || target.family_space_id;
        if (!familySpaceIdResolved && clan_tree_id) {
            const { data: tree } = await supabase.from('clan_trees').select('family_space_id').eq('id', clan_tree_id).maybeSingle();
            familySpaceIdResolved = tree?.family_space_id;
        }

        if (familySpaceIdResolved && req.user?.id) {
            const { data: membership } = await supabase
                .from('family_memberships')
                .select('role, branch_id')
                .eq('family_space_id', familySpaceIdResolved)
                .eq('user_id', req.user.id)
                .maybeSingle();
            const actorRole = normalizeFamilyRole(membership?.role);
            const perms = await getGovernancePermissions(familySpaceIdResolved);

            if (['editor', 'member'].includes(actorRole) && perms.approvalNeeded) {
                try {
                    await supabase.from('claims').insert({
                        family_space_id: familySpaceIdResolved,
                        claimant_id: req.user.id,
                        target_person_id: personId,
                        status: 'pending',
                        claim_type: 'relationship_edit',
                        details: { fatherId, motherId, spouseId, note: 'Queued by governance approvalNeeded policy' }
                    });
                } catch (_) { /* claims table optional */ }
                return res.status(202).json({
                    message: 'Relationship edit submitted for approval (governance policy: editors require approval).',
                    pending_approval: true
                });
            }

            if (actorRole === 'branch-admin' && perms.crossBranchEdits === false) {
                const pFather = await resolvePerson(fatherId);
                const pMother = await resolvePerson(motherId);
                const pSpouse = await resolvePerson(spouseId);
                const actorBranch = membership?.branch_id;
                const foreign = [pFather, pMother, pSpouse, target].filter(Boolean).some(
                    (p) => p.branch_id && actorBranch && p.branch_id !== actorBranch
                );
                if (foreign) {
                    return res.status(403).json({
                        error: 'Cross-branch historical edits are disabled by Owner Governance policy.'
                    });
                }
            }
        }

        const pFather = await resolvePerson(fatherId);
        const pMother = await resolvePerson(motherId);
        const pSpouse = await resolvePerson(spouseId);

        await supabase.from('person_relations').delete().eq('relation_type', 'parent').eq('person_id_2', personId);
        await supabase.from('person_relations').delete().eq('relation_type', 'spouse').or(`person_id_1.eq.${personId},person_id_2.eq.${personId}`);

        const newRels = [];
        if (pFather) newRels.push({ person_id_1: pFather.id, person_id_2: personId, relation_type: 'parent', clan_tree_id });
        if (pMother) newRels.push({ person_id_1: pMother.id, person_id_2: personId, relation_type: 'parent', clan_tree_id });
        if (pSpouse) newRels.push({ person_id_1: personId, person_id_2: pSpouse.id, relation_type: 'spouse', clan_tree_id });

        if (newRels.length > 0) {
            const { error: insErr } = await supabase.from('person_relations').insert(newRels);
            if (insErr) throw new Error(insErr.message);
        }

        res.json({ message: 'Relationships updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// Get custom role labels for a family space
export const getCustomLabels = async (req, res) => {
    try {
        const { id } = req.params;
        if (await checkSuspension(id, res)) return;
        const { data, error } = await supabase
            .from('family_custom_labels')
            .select('*')
            .eq('family_space_id', id);

        if (error) throw error;
        res.status(200).json(data);
    } catch (error) {
        console.error('Error fetching custom labels:', error);
        res.status(500).json({ error: error.message });
    }
};

// Update custom role labels (upsert)
export const updateCustomLabels = async (req, res) => {
    try {
        const { id } = req.params; // family_space_id
        const { labels } = req.body; // Array of { role_key, custom_label }

        if (!Array.isArray(labels)) {
            return res.status(400).json({ error: 'Labels must be an array' });
        }

        const upserts = labels.map(l => ({
            family_space_id: id,
            role_key: l.role_key,
            custom_label: l.custom_label
        }));

        const { data, error } = await supabase
            .from('family_custom_labels')
            .upsert(upserts, { onConflict: 'family_space_id,role_key' })
            .select();

        if (error) throw error;

        try {
            await supabase.from('audit_logs').insert({
                actor_id: req.user?.id || null,
                action: 'FAMILY_SETTINGS_UPDATE',
                target_type: 'family_custom_labels',
                target_id: id,
                ip_address: req.ip || '0.0.0.0',
                details: { family_space_id: id, labels }
            });
        } catch (auditError) {
            console.error('Failed to log custom labels update:', auditError);
        }

        res.status(200).json({ message: 'Labels updated successfully', data });
    } catch (error) {
        console.error('Error updating custom labels:', error);
        res.status(500).json({ error: error.message });
    }
};

/**
 * Get report data for a family space.
 * PRD §20: Descendant pdf generation and download
 */
export const getReportData = async (req, res) => {
    try {
        const { id } = req.params;
        if (await checkSuspension(id, res)) return;

        // 1. Fetch Space Info
        const { data: space, error: sErr } = await supabase.from('family_spaces').select('*').eq('id', id).single();
        if (sErr) throw sErr;

        // 2. Fetch all members with their basic info for reporting
        const { data: members, error: mErr } = await supabase
            .from('family_memberships')
            .select(`
                user_id,
                role,
                status,
                joined_at,
                users (first_name, last_name, email, gender)
            `)
            .eq('family_space_id', id);

        if (mErr) throw mErr;

        // 3. Fetch lineage counts
        const { data: trees } = await supabase.from('clan_trees').select('id').eq('family_space_id', id);
        const treeIds = trees?.map(t => t.id) || [];

        const { count: personCount } = treeIds.length > 0
            ? await supabase.from('persons').select('*', { count: 'exact', head: true }).in('clan_tree_id', treeIds)
            : { count: 0 };

        const { count: branchCount } = await supabase.from('family_branches').select('*', { count: 'exact', head: true }).eq('family_space_id', id);

        try {
            await supabase.from('audit_logs').insert({
                actor_id: req.user?.id || null,
                action: 'FAMILY_REPORT_REQUEST',
                target_type: 'family_spaces',
                target_id: id,
                ip_address: req.ip || '0.0.0.0',
                details: { family_space_id: id, event: 'Generated Descendant Report' }
            });
        } catch (auditError) {}

        res.json({
            space,
            summary: {
                total_accounts: members?.length || 0,
                total_lineage_nodes: personCount || 0,
                total_branches: branchCount || 0
            },
            members: members || [],
            generated_at: new Date()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get family space migration map data for general members.
 */
export const getFamilyMigrationMap = async (req, res) => {
    try {
        const { id: familySpaceId } = req.params;

        // Verify membership of requesting user
        const userId = req.user?.id;
        const { data: membership, error: memError } = await supabase
            .from('family_memberships')
            .select('role')
            .eq('family_space_id', familySpaceId)
            .eq('user_id', userId)
            .single();

        if (memError || !membership) {
            return res.status(403).json({ error: 'Access denied: You are not a member of this family space' });
        }

        // Fetch custom migration points
        const { data: migrationPoints, error: mError } = await supabase
            .from('migration_points')
            .select('*')
            .eq('family_space_id', familySpaceId)
            .order('created_at', { ascending: true });

        if (mError) throw mError;

        // Fetch birth/death points of persons
        const { data: trees } = await supabase.from('clan_trees').select('id').eq('family_space_id', familySpaceId);
        const treeIds = trees?.map(t => t.id) || [];

        let personsPoints = [];
        if (treeIds.length > 0) {
            const { data: persons, error: pError } = await supabase
                .from('persons')
                .select('id, full_name, birth_place, death_place, latitude, longitude, clan_tree_id, birth_date')
                .in('clan_tree_id', treeIds)
                .not('latitude', 'is', null);

            if (!pError && persons) {
                personsPoints = persons;
            }
        }

        res.json({
            family_space_id: familySpaceId,
            migration_data: migrationPoints || [],
            points: personsPoints
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Export Entire Data Vault
 * GET /api/families/:id/export
 */
export const exportFamilySpaceData = async (req, res) => {
    try {
        const { id } = req.params;
        const format = req.query.format || 'json';

        // 1. Fetch space info
        const { data: space } = await supabase.from('family_spaces').select('*').eq('id', id).single();
        if (!space) {
            return res.status(404).json({ error: 'Family space not found' });
        }

        // 2. Fetch members
        const { data: members } = await supabase
            .from('family_memberships')
            .select('id, user_id, role, joined_at, users:user_id (first_name, last_name, email)')
            .eq('family_space_id', id);

        // 3. Fetch lineage persons
        const { data: persons } = await supabase
            .from('persons')
            .select('*')
            .eq('family_space_id', id);

        // 4. Fetch branches
        const { data: branches } = await supabase
            .from('family_branches')
            .select('*')
            .eq('family_space_id', id);

        // 5. Fetch events
        const { data: events } = await supabase
            .from('events')
            .select('*')
            .eq('family_space_id', id);

        // 6. Fetch custom label definitions
        const { data: customLabels } = await supabase
            .from('custom_label_definitions')
            .select('*')
            .eq('family_space_id', id);

        const platformConfig = parseFamilyPlatformConfig(space.settings || {});
        const privacy = parseFamilyPrivacy(space.settings || {}, space.visibility);
        const governance = (space.settings && typeof space.settings === 'object')
            ? (space.settings.governance || space.settings.governance_policy || null)
            : null;

        try {
            await supabase.from('audit_logs').insert({
                actor_id: req.user?.id || null,
                action: 'FAMILY_REPORT_REQUEST',
                target_type: 'family_spaces',
                target_id: id,
                ip_address: req.ip || '0.0.0.0',
                details: { family_space_id: id, format, event: 'Exported Family Space Data' }
            });
        } catch (auditError) {
            console.error('Failed to log family space export:', auditError);
        }

        if (format.toLowerCase() === 'csv') {
            // Member Directory CSV format (members only — documents/media are not included)
            const headers = ['Member ID', 'User ID', 'First Name', 'Last Name', 'Email', 'Role', 'Joined At'];
            const csvRows = [headers.join(',')];

            for (const m of (members || [])) {
                const user = m.users || {};
                const row = [
                    m.id,
                    m.user_id || '',
                    `"${(user.first_name || '').replace(/"/g, '""')}"`,
                    `"${(user.last_name || '').replace(/"/g, '""')}"`,
                    `"${(user.email || '').replace(/"/g, '""')}"`,
                    m.role || '',
                    m.joined_at || ''
                ];
                csvRows.push(row.join(','));
            }

            const csvContent = csvRows.join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="member_directory_${id}.csv"`);
            return res.send(csvContent);
        } else {
            // JSON vault export (structured data; media files / raw documents excluded)
            return res.json({
                exported_at: new Date().toISOString(),
                export_scope: {
                    includes: ['family_space', 'members', 'lineage_persons', 'branches', 'events', 'custom_labels', 'platform_config', 'privacy', 'governance'],
                    excludes: ['media_files', 'document_binaries', 'billing_secrets']
                },
                family_space: space,
                platform_config: platformConfig,
                privacy,
                governance,
                members: (members || []).map(m => ({
                    id: m.id,
                    user_id: m.user_id,
                    role: m.role,
                    joined_at: m.joined_at,
                    first_name: m.users?.first_name || '',
                    last_name: m.users?.last_name || '',
                    email: m.users?.email || ''
                })),
                lineage_persons: persons || [],
                branches: branches || [],
                events: events || [],
                custom_labels: customLabels || []
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get Governance Lock Status
 * GET /api/families/:id/governance-lock
 */
export const getGovernanceLockStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const hasTable = await tableExists('sensitive_changes');
        let changes = [];

        if (hasTable) {
            const { data, error } = await supabase
                .from('sensitive_changes')
                .select('*')
                .eq('family_space_id', id)
                .in('change_type', ['Governance Lock', 'Governance Unlock']);
            if (error) throw error;
            changes = data || [];
        } else {
            const db = readJsonDb();
            changes = (db.sensitive_changes || []).filter(c => c.family_space_id === id && (c.change_type === 'Governance Lock' || c.change_type === 'Governance Unlock'));
        }

        const isLocked = changes.some(c => c.change_type === 'Governance Lock' && c.status === 'approved');
        const isPending = changes.some(c => (c.change_type === 'Governance Lock' || c.change_type === 'Governance Unlock') && c.status === 'pending');

        return res.json({ isLocked, isPending });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Request Governance Lock
 * POST /api/families/:id/governance-lock
 */
export const requestGovernanceLock = async (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;
        const isUnlock = action === 'unlock';
        const requester = req.user ? (req.user.email || req.user.first_name || 'Owner') : 'Owner';
        const hasTable = await tableExists('sensitive_changes');
        let changes = [];

        if (hasTable) {
            const { data, error } = await supabase
                .from('sensitive_changes')
                .select('*')
                .eq('family_space_id', id)
                .in('change_type', ['Governance Lock', 'Governance Unlock']);
            if (error) throw error;
            changes = data || [];
        } else {
            const db = readJsonDb();
            changes = (db.sensitive_changes || []).filter(c => c.family_space_id === id && (c.change_type === 'Governance Lock' || c.change_type === 'Governance Unlock'));
        }

        const isCurrentlyLocked = changes.some(c => c.change_type === 'Governance Lock' && c.status === 'approved');

        if (isUnlock) {
            if (!isCurrentlyLocked) {
                return res.status(400).json({ error: 'Governance is not locked.' });
            }
            if (changes.some(c => c.change_type === 'Governance Unlock' && c.status === 'pending')) {
                return res.status(400).json({ error: 'An unlock request is already pending council approval.' });
            }
        } else {
            if (isCurrentlyLocked) {
                return res.status(400).json({ error: 'Governance is already locked.' });
            }
            if (changes.some(c => c.change_type === 'Governance Lock' && c.status === 'pending')) {
                return res.status(400).json({ error: 'A lock request is already pending council approval.' });
            }
        }

        const changeType = isUnlock ? 'Governance Unlock' : 'Governance Lock';
        const details = isUnlock ? 'Unlock modifications to family governance rules and policies.' : 'Lock all modifications to family governance rules and policies.';

        const newChange = {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
            family_space_id: id,
            requested_by: requester,
            change_type: changeType,
            details: details,
            status: 'pending',
            created_at: new Date().toISOString()
        };

        if (hasTable) {
            const { data, error } = await supabase
                .from('sensitive_changes')
                .insert({
                    id: newChange.id,
                    family_space_id: newChange.family_space_id,
                    requested_by: newChange.requested_by,
                    change_type: newChange.change_type,
                    details: newChange.details,
                    status: newChange.status
                })
                .select()
                .single();
            if (error) throw error;
            
            try {
                await supabase.from('audit_logs').insert({
                    actor_id: req.user?.id || null,
                    action: 'FAMILY_GOVERNANCE_LOCK',
                    target_type: 'family_spaces',
                    target_id: id,
                    ip_address: req.ip || '0.0.0.0',
                    details: { family_space_id: id, status: newChange.status }
                });
            } catch (auditError) {}

            return res.status(201).json(data);
        } else {
            const db = readJsonDb();
            if (!db.sensitive_changes) db.sensitive_changes = [];
            db.sensitive_changes.push(newChange);
            writeJsonDb(db);
            return res.status(201).json(newChange);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Transfer ownership of a family space.
 * Only the current owner can perform this action.
 */
export const transferOwnership = async (req, res) => {
    try {
        const { id } = req.params; // family_space_id
        const target_user_id = req.body.target_user_id || req.body.newOwnerId;
        const { user } = req; // current owner

        if (!target_user_id) {
            return res.status(400).json({ error: 'Target user ID is required (target_user_id or newOwnerId)' });
        }

        // 1. Verify current user is the owner of the family space
        const { data: space, error: spaceError } = await supabase
            .from('family_spaces')
            .select('owner_id')
            .eq('id', id)
            .single();

        if (spaceError || !space) {
            return res.status(404).json({ error: 'Family space not found' });
        }

        if (space.owner_id !== user.id) {
            return res.status(403).json({ error: 'Only the current owner can transfer ownership' });
        }

        if (target_user_id === user.id) {
            return res.status(400).json({ error: 'Cannot transfer ownership to yourself' });
        }

        // 2. Verify target user is a member of the family
        const { data: targetMembership, error: targetError } = await supabase
            .from('family_memberships')
            .select('*')
            .eq('family_space_id', id)
            .eq('user_id', target_user_id)
            .single();

        if (targetError || !targetMembership) {
            return res.status(400).json({ error: 'Target user is not a member of this family space' });
        }

        // 3. Update family_spaces owner_id
        const { error: updateSpaceError } = await supabase
            .from('family_spaces')
            .update({ owner_id: target_user_id })
            .eq('id', id);

        if (updateSpaceError) throw updateSpaceError;

        // 4. Update family_memberships roles
        // Demote current owner to family-admin
        await supabase
            .from('family_memberships')
            .update({ role: 'family-admin' })
            .eq('family_space_id', id)
            .eq('user_id', user.id);

        // Promote target user to owner
        await supabase
            .from('family_memberships')
            .update({ role: 'owner' })
            .eq('family_space_id', id)
            .eq('user_id', target_user_id);

        // Update family_space_staff as well if it exists
        await supabase
            .from('family_space_staff')
            .update({ role: 'family-admin' })
            .eq('family_space_id', id)
            .eq('user_id', user.id);

        await supabase
            .from('family_space_staff')
            .update({ role: 'owner' })
            .eq('family_space_id', id)
            .eq('user_id', target_user_id);

        // 5. Log the action in audit_logs
        await supabase.from('audit_logs').insert({
            actor_id: user.id,
            action: 'OWNERSHIP_TRANSFERRED',
            target_type: 'family_spaces',
            target_id: id,
            details: { previous_owner: user.id, new_owner: target_user_id }
        });

        res.json({ message: 'Ownership transferred successfully' });
    } catch (err) {
        console.error('>>> [TRANSFER_OWNERSHIP_ERROR]', err);
        res.status(500).json({ error: err.message });
    }
};

