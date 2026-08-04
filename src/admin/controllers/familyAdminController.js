import { supabase } from '../../config/supabaseClient.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';
import { logActivity } from '../../utils/logger.js';
import {
    FAMILY_ROLE_META,
    normalizeFamilyRole,
    getAssignableRoles,
    readAdminDelegations,
    DEFAULT_ADMIN_DELEGATIONS,
    canManageFamilyRoles
} from '../../utils/familyRolePolicy.js';
import { loadFamilyKccLedger, summarizeKccRows } from '../../utils/familyKccLedger.js';

const ADMIN_ROLES = ['owner', 'admin', 'manager', 'editor', 'branch', 'branch-admin', 'family', 'family-admin', 'family_admin', 'co-admin'];
const OWNER_ROLES = ['owner'];
const PLATFORM_FALLBACK_ROLES = ['superadmin', 'super_admin', 'family', 'family_admin', 'family-admin', 'owner', 'admin'];
const SYSTEM_ADMIN_EMAILS = ['family@admin.com', 'superadmin@kincore.com'];

const isUuid = (value) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

const normalizeRole = (role) => {
    const r = String(role || '').toLowerCase();
    if (['family-admin', 'family admin', 'admin', 'family', 'family_admin'].includes(r)) return 'family-admin';
    if (['co-admin', 'coadmin'].includes(r)) return 'co-admin';
    if (['branch-admin', 'branch admin', 'manager', 'branch'].includes(r)) return 'branch-admin';
    if (['editor', 'council', 'council-admin'].includes(r)) return 'editor';
    return r;
};

const resolveFamilySpaceId = async (req) => {
    let familySpaceId =
        req.params.familySpaceId ||
        req.params.family_space_id ||
        req.body.family_space_id ||
        req.query.family_space_id ||
        req.body.familySpaceId ||
        req.query.familySpaceId;

    if (isUuid(familySpaceId)) return familySpaceId;

    const { data: memberships } = await supabase
        .from('family_memberships')
        .select('family_space_id, role')
        .eq('user_id', req.user.id);

    if (memberships?.length) {
        // Sort by most recently joined if multiple
        const sorted = [...memberships].sort((a, b) => new Date(b.joined_at) - new Date(a.joined_at));
        const best = sorted.find((m) => OWNER_ROLES.includes(normalizeRole(m.role))) || sorted[0];
        return best.family_space_id;
    }

    const { data: staff } = await supabase
        .from('family_space_staff')
        .select('family_space_id, role')
        .eq('user_id', req.user.id)
        .eq('is_active', true)
        .limit(1);

    if (staff?.length) return staff[0].family_space_id;

    const { data: platformAdmin } = await supabase
        .from('admin_users')
        .select('role')
        .eq('user_id', req.user.id)
        .maybeSingle();

    if (PLATFORM_FALLBACK_ROLES.includes(normalizeRole(platformAdmin?.role))) {
        const { data: firstSpace } = await supabase
            .from('family_spaces')
            .select('id')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        return firstSpace?.id;
    }

    return null;
};

const requireFamilyAdmin = async (req, res, allowedRoles = ADMIN_ROLES) => {
    const familySpaceId = await resolveFamilySpaceId(req);
    if (!familySpaceId) {
        res.status(400).json({ error: 'family_space_id is required' });
        return null;
    }

    const { data: membership } = await supabase
        .from('family_memberships')
        .select('role')
        .eq('family_space_id', familySpaceId)
        .eq('user_id', req.user.id)
        .maybeSingle();

    const membershipRole = normalizeRole(membership?.role);
    if (allowedRoles.map(normalizeRole).includes(membershipRole)) {
        return { familySpaceId, role: membershipRole };
    }

    const { data: staff } = await supabase
        .from('family_space_staff')
        .select('role')
        .eq('family_space_id', familySpaceId)
        .eq('user_id', req.user.id)
        .eq('is_active', true)
        .maybeSingle();

    const staffRole = normalizeRole(staff?.role);
    if (allowedRoles.map(normalizeRole).includes(staffRole)) {
        return { familySpaceId, role: staffRole };
    }

    const { data: platformAdmin } = await supabase
        .from('admin_users')
        .select('role')
        .eq('user_id', req.user.id)
        .maybeSingle();

    const platformRole = normalizeRole(platformAdmin?.role);
    if (PLATFORM_FALLBACK_ROLES.includes(platformRole) || SYSTEM_ADMIN_EMAILS.includes(req.user.email)) {
        return { familySpaceId, role: platformRole || 'superadmin' };
    }

    res.status(403).json({ error: 'Access denied. Family admin role required.' });
    return null;
};

const getFamilyTreeIds = async (familySpaceId) => {
    const { data, error } = await supabase
        .from('clan_trees')
        .select('id')
        .eq('family_space_id', familySpaceId);

    if (error) throw error;
    return data?.map((tree) => tree.id) || [];
};

const getFamilyPersonIds = async (familySpaceId) => {
    const treeIds = await getFamilyTreeIds(familySpaceId);
    const personIds = new Set();

    if (treeIds.length) {
        const { data, error } = await supabase
            .from('persons')
            .select('id')
            .in('clan_tree_id', treeIds);
        if (error) throw error;
        (data || []).forEach((person) => personIds.add(person.id));
    }

    const { data: taggedPersons } = await supabase
        .from('persons')
        .select('id')
        .eq('family_space_id', familySpaceId);

    (taggedPersons || []).forEach((person) => personIds.add(person.id));
    return Array.from(personIds);
};

const getUnifiedFamilyPopulation = async (familySpaceId) => {
    const { data: accounts, error: accountsError } = await supabase
        .from('family_memberships')
        .select('user_id, role, status, joined_at, users:user_id(first_name, last_name, email, avatar_url)')
        .eq('family_space_id', familySpaceId);

    if (accountsError) throw accountsError;

    const treeIds = await getFamilyTreeIds(familySpaceId);
    const { data: branches } = await supabase
        .from('family_branches')
        .select('id')
        .eq('family_space_id', familySpaceId);
    const branchIds = branches?.map((branch) => branch.id) || [];

    const personMap = new Map();

    if (treeIds.length) {
        const { data: treePersons, error } = await supabase
            .from('persons')
            .select('id, full_name, first_name, last_name, claimed_by, created_at, branch_id, clan_tree_id')
            .in('clan_tree_id', treeIds);
        if (error) throw error;
        (treePersons || []).forEach((person) => personMap.set(person.id, person));
    }

    const { data: taggedPersons } = await supabase
        .from('persons')
        .select('id, full_name, first_name, last_name, claimed_by, created_at, branch_id, clan_tree_id')
        .eq('family_space_id', familySpaceId);
    (taggedPersons || []).forEach((person) => personMap.set(person.id, person));

    if (branchIds.length) {
        const { data: branchPersons } = await supabase
            .from('persons')
            .select('id, full_name, first_name, last_name, claimed_by, created_at, branch_id, clan_tree_id')
            .in('branch_id', branchIds);
        (branchPersons || []).forEach((person) => personMap.set(person.id, person));
    }

    const accountIds = new Set((accounts || []).map((account) => account.user_id).filter(Boolean));
    const unclaimedOrUnlinkedPersons = Array.from(personMap.values()).filter((person) => !person.claimed_by || !accountIds.has(person.claimed_by));

    return {
        accounts: accounts || [],
        persons: Array.from(personMap.values()),
        unifiedCount: (accounts || []).length + unclaimedOrUnlinkedPersons.length,
        unclaimedLineageCount: unclaimedOrUnlinkedPersons.length
    };
};

const safeCount = async (table, applyFilters = (query) => query) => {
    const query = applyFilters(supabase.from(table).select('*', { count: 'exact', head: true }));
    const { count, error } = await query;
    if (error) return 0;
    return count || 0;
};

const safeAudit = async (actorId, action, targetType, targetId, req, details = {}) => {
    await logActivity(actorId, action, targetType, targetId, req.ip || null, details);
};

export const getFamilyAdminDashboard = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { familySpaceId } = context;
        const population = await getUnifiedFamilyPopulation(familySpaceId);

        const [pendingClaimsCount, eventCount, mediaCount, branchCount] = await Promise.all([
            safeCount('claims', (query) => query.eq('family_space_id', familySpaceId).eq('status', 'pending')),
            safeCount('events', (query) => query.eq('family_space_id', familySpaceId)),
            safeCount('media', (query) => query.eq('family_space_id', familySpaceId)),
            safeCount('family_branches', (query) => query.eq('family_space_id', familySpaceId))
        ]);

        const userIds = population.accounts.map((member) => member.user_id).filter(Boolean);

        const { rows: ledgerRows } = await loadFamilyKccLedger(supabase, {
            familySpaceId,
            userIds,
            limit: 5000
        });
        const kccSummary = summarizeKccRows(ledgerRows);
        const kccBalance = kccSummary.net_balance;

        const { data: recentMembers } = await supabase
            .from('family_memberships')
            .select('joined_at, role, users:user_id(first_name, last_name, email, avatar_url)')
            .eq('family_space_id', familySpaceId)
            .order('joined_at', { ascending: false })
            .limit(5);

        const { data: recentClaims } = await supabase
            .from('claims')
            .select('id, status, created_at, user:users(first_name, last_name, email), person:persons(full_name)')
            .eq('family_space_id', familySpaceId)
            .order('created_at', { ascending: false })
            .limit(5);

        res.set('Cache-Control', 'no-store');
        res.json({
            family_space_id: familySpaceId,
            stats: {
                total_members: population.unifiedCount,
                account_members: population.accounts.length,
                active_claims: pendingClaimsCount,
                lineage_nodes: population.persons.length,
                unclaimed_lineage_nodes: population.unclaimedLineageCount,
                branches: branchCount,
                events: eventCount,
                media_items: mediaCount,
                storage_used: (await supabase.from('media').select('storage_size').eq('family_space_id', familySpaceId)).data?.reduce((sum, m) => sum + Number(m.storage_size || 0), 0) || 0,
                storage_limit_gb: 200,
                kcc_balance: kccBalance,
                kcc_credits: kccSummary.total_credits,
                kcc_debits: kccSummary.total_debits,
                kcc_tx_count: kccSummary.transaction_count
            },
            performance: {
                member_growth: [],
                claim_resolution: null
            },
            activity_feed: [
                ...(recentMembers || []).map((member) => ({
                    type: 'member_joined',
                    title: 'Member joined',
                    description: `${member.users?.first_name || ''} ${member.users?.last_name || ''}`.trim() || member.users?.email || 'Family member',
                    created_at: member.joined_at
                })),
                ...(recentClaims || []).map((claim) => ({
                    type: 'claim',
                    title: `Claim ${claim.status}`,
                    description: claim.person?.full_name || 'Lineage claim',
                    actor: `${claim.user?.first_name || ''} ${claim.user?.last_name || ''}`.trim() || claim.user?.email,
                    created_at: claim.created_at
                }))
            ],
            alerts: {
                pending_claims: pendingClaimsCount,
                pending_moderation: 0
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};


export const getFamilyAdminClaims = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const status = req.query.status || 'pending';
        let query = supabase
            .from('claims')
            .select(`
                *,
                user:users(first_name, last_name, email, avatar_url),
                person:persons(
                    id, 
                    full_name, 
                    avatar_url, 
                    gender, 
                    birth_date, 
                    clan_tree_id, 
                    branch_id,
                    branch:family_branches!persons_branch_id_fkey(name)
                )
            `)
            .eq('family_space_id', context.familySpaceId);

        if (status !== 'all') query = query.eq('status', status);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        res.json({ family_space_id: context.familySpaceId, claims: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const resolveFamilyAdminClaim = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res, OWNER_ROLES);
        if (!context) return;

        const { claimId } = req.params;
        const { action, status, reason } = req.body;
        const nextStatus = {
            approve: 'approved',
            approved: 'approved',
            reject: 'rejected',
            rejected: 'rejected',
            request_proof: 'proof_requested',
            flag_conflict: 'conflict'
        }[normalizeRole(action || status)];

        if (!nextStatus) return res.status(400).json({ error: 'Invalid claim action' });

        const { data: claim, error: claimError } = await supabase
            .from('claims')
            .select('*')
            .eq('id', claimId)
            .eq('family_space_id', context.familySpaceId)
            .maybeSingle();

        if (claimError) throw claimError;
        if (!claim) return res.status(404).json({ error: 'Claim not found in this family space' });

        let updatePayload = {
            status: nextStatus,
            rejection_reason: nextStatus === 'rejected' ? reason || null : null,
            claimed_at: nextStatus === 'approved' ? new Date().toISOString() : null
        };

        let { data, error } = await supabase
            .from('claims')
            .update(updatePayload)
            .eq('id', claimId)
            .select()
            .single();

        if (error) {
            updatePayload = { status: nextStatus };
            const retry = await supabase
                .from('claims')
                .update(updatePayload)
                .eq('id', claimId)
                .select()
                .single();
            data = retry.data;
            error = retry.error;
        }

        if (error) throw error;

        if (nextStatus === 'approved') {
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
                title: 'Claim approved',
                message: 'Your family tree claim has been approved.'
            });
        }

        try {
            const { dispatchNotification } = await import('../../services/notificationService.js');
            dispatchNotification(
                context.familySpaceId,
                'Claim request',
                `Claim ${nextStatus}`,
                `A lineage claim was ${nextStatus}${reason ? `: ${reason}` : ''}.`,
                undefined,
                {
                    channel: 'claims',
                    extraUserIds: claim.user_id ? [claim.user_id] : []
                }
            ).catch(() => {});
        } catch (_) { /* non-blocking */ }

        await safeAudit(req.user.id, `FAMILY_CLAIM_${nextStatus}`, 'claims', claimId, req, {
            family_space_id: context.familySpaceId,
            reason: reason || null
        });

        res.json({ message: `Claim ${nextStatus}`, claim: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
export const getFamilyAdminMedia = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        let query = supabase
            .from('media')
            .select(`
                *,
                user:users(first_name, last_name, email),
                tags:media_tags(
                    person:persons(id, full_name, avatar_url)
                )
            `)
            .eq('family_space_id', context.familySpaceId);

        if (req.query.type) query = query.eq('type', req.query.type);

        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;

        res.json({ family_space_id: context.familySpaceId, media: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const deleteFamilyAdminMedia = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res, OWNER_ROLES);
        if (!context) return;

        const { mediaId } = req.params;

        // 1. Get media info to delete from storage
        const { data: media, error: getError } = await supabase
            .from('media')
            .select('url')
            .eq('id', mediaId)
            .eq('family_space_id', context.familySpaceId)
            .single();

        if (getError || !media) return res.status(404).json({ error: 'Media not found' });

        // 2. Extract path from URL (Supabase storage URL format)
        // Example: https://.../storage/v1/object/public/media/path/to/file.jpg
        const path = media.url.split('/media/').pop();

        // 3. Delete from S3/Storage
        const { deleteFile, BUCKETS } = await import('../../config/storageClient.js');
        await deleteFile(BUCKETS.MEDIA, path);

        // 4. Delete from DB
        const { error: deleteError } = await supabase
            .from('media')
            .delete()
            .eq('id', mediaId);

        if (deleteError) throw deleteError;

        await safeAudit(req.user.id, 'FAMILY_MEDIA_DELETE', 'media', mediaId, req, {
            family_space_id: context.familySpaceId
        });

        res.json({ message: 'Media deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const tagMediaPerson = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { mediaId } = req.params;
        const { personId } = req.body;

        const { data, error } = await supabase
            .from('media_tags')
            .insert({ media_id: mediaId, person_id: personId })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') { // Unique constraint violation
                return res.status(200).json({ message: 'Person already tagged' });
            }
            throw error;
        }

        res.status(201).json({ message: 'Person tagged', tag: data });
    } catch (err) {
        console.error('>>> TAG MEDIA PERSON ERROR:', err);
        res.status(500).json({ error: err.message, details: err });
    }
};

export const untagMediaPerson = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { mediaId, personId } = req.params;

        const { error } = await supabase
            .from('media_tags')
            .delete()
            .eq('media_id', mediaId)
            .eq('person_id', personId);

        if (error) throw error;

        res.json({ message: 'Person untagged' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const uploadFamilyAdminMedia = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const ext = req.file.originalname.split('.').pop().toLowerCase();
        const baseName = req.file.originalname.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9.-]/g, '_');
        const path = `${context.familySpaceId}/${req.user.id}-${Date.now()}-${baseName}.${ext}`;
        const url = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype);

        const { data, error } = await supabase
            .from('media')
            .insert({
                user_id: req.user.id,
                family_space_id: context.familySpaceId,
                url,
                type: req.file.mimetype.startsWith('video') ? 'video' : req.file.mimetype === 'application/pdf' ? 'document' : 'image',
                visibility: req.body.visibility || 'family',
                storage_size: req.file.size || 0,
                metadata: {
                    original_name: req.file.originalname,
                    mimetype: req.file.mimetype,
                    title: req.body.title || '',
                    location: req.body.location || '',
                    event_id: req.body.event_id || null
                }
            })
            .select()
            .single();

        if (error) throw error;

        await safeAudit(req.user.id, 'FAMILY_MEDIA_UPLOAD', 'media', data.id, req, {
            family_space_id: context.familySpaceId
        });

        res.status(201).json({ message: 'Media uploaded', media: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminMigrationMap = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        // Fetch custom migration points from migration_points table
        const { data: migrationPoints, error: mError } = await supabase
            .from('migration_points')
            .select('*')
            .eq('family_space_id', context.familySpaceId)
            .order('created_at', { ascending: true });

        if (mError) throw mError;

        // Fetch birth/death points of persons
        const treeIds = await getFamilyTreeIds(context.familySpaceId);
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
            family_space_id: context.familySpaceId,
            migration_data: migrationPoints || [],
            points: personsPoints
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const createFamilyAdminMigrationPoint = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const {
            title,
            fromLocation,
            toLocation,
            fromCoords,
            toCoords,
            reason,
            isBranchMigration,
            dateType,
            dateValue,
            dateRange,
            approximatePeriod,
            description,
            media,
            branches,
            persons,
            historyChapters,
            tags,
            visibility,
            sources
        } = req.body;

        const { data, error } = await supabase
            .from('migration_points')
            .insert({
                family_space_id: context.familySpaceId,
                title,
                from_location: fromLocation,
                to_location: toLocation,
                from_lat: fromCoords?.lat ? parseFloat(fromCoords.lat) : null,
                from_lng: fromCoords?.lng ? parseFloat(fromCoords.lng) : null,
                to_lat: toCoords?.lat ? parseFloat(toCoords.lat) : null,
                to_lng: toCoords?.lng ? parseFloat(toCoords.lng) : null,
                reason: reason || 'Relocation',
                is_branch_migration: isBranchMigration || false,
                date_type: dateType || 'Exact Date',
                date_value: dateValue || null,
                date_range_start: dateRange?.start || null,
                date_range_end: dateRange?.end || null,
                approximate_period: approximatePeriod || null,
                description,
                media: media || [],
                branches: branches || [],
                persons: persons || [],
                history_chapters: historyChapters || [],
                tags: tags || [],
                visibility: visibility || 'Family',
                sources
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json({ message: 'Migration point created successfully', migration_point: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updateFamilyAdminMigrationPoint = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { pointId } = req.params;
        const {
            title,
            fromLocation,
            toLocation,
            fromCoords,
            toCoords,
            reason,
            isBranchMigration,
            dateType,
            dateValue,
            dateRange,
            approximatePeriod,
            description,
            media,
            branches,
            persons,
            historyChapters,
            tags,
            visibility,
            sources
        } = req.body;

        const { data, error } = await supabase
            .from('migration_points')
            .update({
                title,
                from_location: fromLocation,
                to_location: toLocation,
                from_lat: fromCoords?.lat ? parseFloat(fromCoords.lat) : null,
                from_lng: fromCoords?.lng ? parseFloat(fromCoords.lng) : null,
                to_lat: toCoords?.lat ? parseFloat(toCoords.lat) : null,
                to_lng: toCoords?.lng ? parseFloat(toCoords.lng) : null,
                reason: reason || 'Relocation',
                is_branch_migration: isBranchMigration || false,
                date_type: dateType || 'Exact Date',
                date_value: dateValue || null,
                date_range_start: dateRange?.start || null,
                date_range_end: dateRange?.end || null,
                approximate_period: approximatePeriod || null,
                description,
                media: media || [],
                branches: branches || [],
                persons: persons || [],
                history_chapters: historyChapters || [],
                tags: tags || [],
                visibility: visibility || 'Family',
                sources,
                updated_at: new Date()
            })
            .eq('id', pointId)
            .eq('family_space_id', context.familySpaceId)
            .select()
            .single();

        if (error) throw error;
        res.json({ message: 'Migration point updated successfully', migration_point: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const deleteFamilyAdminMigrationPoint = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { pointId } = req.params;

        const { error } = await supabase
            .from('migration_points')
            .delete()
            .eq('id', pointId)
            .eq('family_space_id', context.familySpaceId);

        if (error) throw error;
        res.json({ message: 'Migration point deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminKccLedger = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data: members } = await supabase
            .from('family_memberships')
            .select('user_id')
            .eq('family_space_id', context.familySpaceId);

        const userIds = (members || []).map((member) => member.user_id).filter(Boolean);
        const { rows, attribution, hasFamilySpaceColumn } = await loadFamilyKccLedger(supabase, {
            familySpaceId: context.familySpaceId,
            userIds,
            limit: 200
        });

        const summary = summarizeKccRows(rows);

        res.json({
            family_space_id: context.familySpaceId,
            transactions: rows,
            // Back-compat: total_coins was historically "volume"; prefer net_balance for UI
            total_coins: summary.net_balance,
            net_balance: summary.net_balance,
            total_credits: summary.total_credits,
            total_debits: summary.total_debits,
            volume: summary.volume,
            transaction_count: summary.transaction_count,
            attribution,
            has_family_space_column: hasFamilySpaceColumn,
            source: 'local_kcc_ledger'
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminPersons = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const population = await getUnifiedFamilyPopulation(context.familySpaceId);
        res.json({ family_space_id: context.familySpaceId, persons: population.persons || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminBranches = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data: branches, error } = await supabase
            .from('family_branches')
            .select('*')
            .eq('family_space_id', context.familySpaceId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ family_space_id: context.familySpaceId, branches: branches || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminReports = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const [memberCount, branchCount] = await Promise.all([
            safeCount('family_memberships', (query) => query.eq('family_space_id', context.familySpaceId)),
            safeCount('family_branches', (query) => query.eq('family_space_id', context.familySpaceId))
        ]);

        const treeIds = await getFamilyTreeIds(context.familySpaceId);
        const lineageCount = treeIds.length
            ? await safeCount('persons', (query) => query.in('clan_tree_id', treeIds))
            : 0;

        const { data: reports, error: reportError } = await supabase
            .from('family_reports')
            .select('*')
            .eq('family_space_id', context.familySpaceId)
            .order('created_at', { ascending: false });

        if (reportError) throw reportError;

        res.json({
            family_space_id: context.familySpaceId,
            summary: {
                total_accounts: memberCount,
                total_lineage_nodes: lineageCount,
                total_branches: branchCount
            },
            templates: [
                { key: 'descendant_tree', name: 'Descendant Tree PDF' },
                { key: 'ancestor_report', name: 'Ancestor Lineage Report' },
                { key: 'album_book', name: 'Album & Book Builder' },
                { key: 'growth_metrics', name: 'Branch Growth Report' }
            ],
            reports: reports || [],
            exports: reports || [] // Legacy support
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const createFamilyAdminReport = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { report_type, config = {} } = req.body;
        
        // 1. Fetch Real Data for the Report
        const [memberData, personData, branchData, spaceData] = await Promise.all([
            supabase.from('family_memberships').select('*, users(first_name, last_name, email)').eq('family_space_id', context.familySpaceId),
            supabase.from('persons').select('*').in('clan_tree_id', await getFamilyTreeIds(context.familySpaceId)),
            supabase.from('family_branches').select('*').eq('family_space_id', context.familySpaceId),
            supabase.from('family_spaces').select('*').eq('id', context.familySpaceId).single()
        ]);

        // 2. Generate Real Report Content
        const timestamp = new Date().toLocaleString();
        const reportTitle = report_type.toUpperCase().replace(/_/g, ' ');
        const reportContent = `
            <div style="font-family: sans-serif; padding: 40px; color: #333;">
                <h1 style="color: #f97316;">KINCORE: ${reportTitle}</h1>
                <p><strong>Family:</strong> ${spaceData.data?.name || 'Kincore Family'}</p>
                <p><strong>Generated:</strong> ${timestamp}</p>
                <hr style="border: 1px solid #eee; margin: 20px 0;" />
                
                <h2>Family Statistics</h2>
                <ul>
                    <li>Total Members: ${memberData.data?.length || 0}</li>
                    <li>Lineage Nodes: ${personData.data?.length || 0}</li>
                    <li>Active Branches: ${branchData.data?.length || 0}</li>
                </ul>

                <h2>Member Registry</h2>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr style="background: #f8f8f8; text-align: left;">
                        <th style="padding: 10px; border-bottom: 2px solid #eee;">Name</th>
                        <th style="padding: 10px; border-bottom: 2px solid #eee;">Role</th>
                        <th style="padding: 10px; border-bottom: 2px solid #eee;">Status</th>
                    </tr>
                    ${(memberData.data || []).map(m => `
                        <tr>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;">${m.users?.first_name} ${m.users?.last_name}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;">${m.role}</td>
                            <td style="padding: 10px; border-bottom: 1px solid #eee;">${m.status}</td>
                        </tr>
                    `).join('')}
                </table>
            </div>
        `;

        // 3. Upload to Storage
        const { uploadFile, BUCKETS } = await import('../../config/storageClient.js');
        const fileName = `${context.familySpaceId}/report_${Date.now()}.html`;
        const fileUrl = await uploadFile(BUCKETS.REPORTS, fileName, Buffer.from(reportContent), 'text/html');

        // 4. Record in DB
        const { data, error } = await supabase
            .from('family_reports')
            .insert({
                family_space_id: context.familySpaceId,
                report_type: report_type || 'Custom Report',
                config,
                status: 'completed',
                file_url: fileUrl
            })
            .select()
            .single();

        if (error) throw error;

        await safeAudit(req.user.id, 'FAMILY_REPORT_REQUEST', 'family_reports', data.id, req, { report_type, config });

        res.status(201).json({
            message: 'Report generation queued',
            report: data
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
export const updateFamilyAdminLogo = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        if (!req.file) {
            return res.status(400).json({ error: 'No logo file provided' });
        }

        const { uploadFile, BUCKETS } = await import('../../config/storageClient.js');
        const fileName = `${context.familySpaceId}/logo_${Date.now()}_${req.file.originalname}`;
        const logoUrl = await uploadFile(BUCKETS.AVATARS, fileName, req.file.buffer, req.file.mimetype);

        const { error } = await supabase
            .from('family_spaces')
            .update({ logo_url: logoUrl })
            .eq('id', context.familySpaceId);

        if (error) throw error;

        res.json({ message: 'Logo updated successfully', logo_url: logoUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const exportFamilyAdminData = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const memberRes = await supabase
            .from('family_memberships')
            .select('*, users(*)')
            .eq('family_space_id', context.familySpaceId);

        const userIds = (memberRes.data || []).map((m) => m.user_id).filter(Boolean);
        const [branches, trees, persons, moderation, kccPack] = await Promise.all([
            supabase.from('family_branches').select('*').eq('family_space_id', context.familySpaceId),
            supabase.from('clan_trees').select('*').eq('family_space_id', context.familySpaceId),
            supabase.from('persons').select('*').in('clan_tree_id', await getFamilyTreeIds(context.familySpaceId)),
            supabase.from('content_moderation').select('*').eq('family_space_id', context.familySpaceId),
            loadFamilyKccLedger(supabase, {
                familySpaceId: context.familySpaceId,
                userIds,
                limit: 5000
            })
        ]);

        const kccSummary = summarizeKccRows(kccPack.rows || []);

        const exportData = {
            family_space_id: context.familySpaceId,
            exported_at: new Date().toISOString(),
            members: memberRes.data || [],
            branches: branches.data || [],
            trees: trees.data || [],
            lineage: persons.data || [],
            moderation_history: moderation.data || [],
            financial_ledger: kccPack.rows || [],
            kcc_summary: kccSummary,
            kcc_attribution: kccPack.attribution
        };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=family_export_${context.familySpaceId}.json`);
        res.send(JSON.stringify(exportData, null, 4));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminSettings = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data, error } = await supabase
            .from('family_spaces')
            .select('*')
            .eq('id', context.familySpaceId)
            .single();

        if (error) throw error;
        
        const settingsPayload = {
            ...data,
            ...(data.settings || {})
        };
        
        res.json({ family_space_id: context.familySpaceId, settings: settingsPayload });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updateFamilyAdminSettings = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res, OWNER_ROLES);
        if (!context) return;

        const topLevelKeys = ['name', 'description', 'code', 'status', 'category', 'region', 'contact_email', 'contact_phone', 'visibility'];
        const settingsKeys = ['origin_location', 'registration_rules', 'default_visibility', 'notifications', 'logo_url'];

        const topLevelUpdates = {};
        const settingsUpdates = {};
        
        topLevelKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) topLevelUpdates[key] = req.body[key];
        });
        
        settingsKeys.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(req.body, key)) settingsUpdates[key] = req.body[key];
        });

        if (!Object.keys(topLevelUpdates).length && !Object.keys(settingsUpdates).length) {
            return res.status(400).json({ error: 'No supported settings provided' });
        }
        
        let updates = { ...topLevelUpdates };
        
        if (Object.keys(settingsUpdates).length > 0) {
            const { data: currData, error: currError } = await supabase
                .from('family_spaces')
                .select('settings')
                .eq('id', context.familySpaceId)
                .single();
                
            if (currError) throw currError;
             
            updates.settings = {
                ...(currData.settings || {}),
                ...settingsUpdates
            };
        }

        const { data, error } = await supabase
            .from('family_spaces')
            .update(updates)
            .eq('id', context.familySpaceId)
            .select()
            .single();

        if (error) throw error;

        await safeAudit(req.user.id, 'FAMILY_SETTINGS_UPDATE', 'family_spaces', context.familySpaceId, req, { ...topLevelUpdates, ...settingsUpdates });
        res.json({ message: 'Family settings updated', settings: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminAuditLogs = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { page = 1, limit = 20 } = req.query;
        const pageNum = parseInt(page, 10) || 1;
        const limitNum = parseInt(limit, 10) || 20;
        const from = (pageNum - 1) * limitNum;
        const to = from + limitNum - 1;

        // Resolve user's actual branch if they are branch admin
        const isBranchAdmin = context.role === 'branch-admin' || context.role === 'branch' || req.user?.role === 'branch';
        let branchId = null;

        if (isBranchAdmin) {
            // Find their branch_id
            const { data: userDetails } = await supabase
                .from('users')
                .select('branch_id')
                .eq('id', req.user.id)
                .maybeSingle();
            branchId = userDetails?.branch_id;
        }

        let query = supabase
            .from('audit_logs')
            .select('*, actor:users!actor_id(first_name, last_name, email, admin:admin_users(role))', { count: 'exact' });

        if (isBranchAdmin) {
            if (branchId) {
                query = query.or(
                    `and(target_type.eq.branches,target_id.eq.${branchId}),` +
                    `details->>branch_id.eq.${branchId},` +
                    `details->>branchId.eq.${branchId}`
                );
            } else {
                // If branch admin has no branch assigned, they see nothing
                return res.json({
                    family_space_id: context.familySpaceId,
                    logs: [],
                    page: pageNum,
                    limit: limitNum,
                    totalCount: 0,
                    totalPages: 0
                });
            }
        } else {
            const { data: famMembers } = await supabase
                .from('family_memberships')
                .select('user_id')
                .eq('family_space_id', context.familySpaceId);
            const memberUserIds = (famMembers || []).map(m => m.user_id).filter(Boolean);

            const orConditions = [
                `ip_address.eq.${context.familySpaceId}`,
                `and(target_type.eq.family_spaces,target_id.eq.${context.familySpaceId})`,
                `details->>family_space_id.eq.${context.familySpaceId}`,
                `details->>familySpaceId.eq.${context.familySpaceId}`
            ];
            if (memberUserIds.length > 0) {
                orConditions.push(`actor_id.in.(${memberUserIds.join(',')})`);
            }
            query = query.or(orConditions.join(','));
        }

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;

        // Map roles nicely for response
        const mappedLogs = (data || []).map(log => {
            let role = 'User';
            if (log.actor?.admin) {
                const adminData = Array.isArray(log.actor.admin) ? log.actor.admin[0] : log.actor.admin;
                if (adminData?.role) {
                    role = adminData.role;
                }
            }
            return {
                ...log,
                actor: log.actor ? {
                    first_name: log.actor.first_name,
                    last_name: log.actor.last_name,
                    email: log.actor.email,
                    role: role
                } : null
            };
        });

        res.json({
            family_space_id: context.familySpaceId,
            logs: mappedLogs,
            page: pageNum,
            limit: limitNum,
            totalCount: count || 0,
            totalPages: Math.ceil((count || 0) / limitNum)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
export const getFamilyAdminEvents = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data, error } = await supabase
            .from('events')
            .select('id, title, start_date, location')
            .eq('family_space_id', context.familySpaceId)
            .order('start_date', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const linkMediaToEvent = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { mediaId } = req.params;
        const { eventId } = req.body;

        const { data: media, error: fetchError } = await supabase
            .from('media')
            .select('metadata')
            .eq('id', mediaId)
            .single();

        if (fetchError) throw fetchError;

        const updatedMetadata = {
            ...(media.metadata || {}),
            event_id: eventId
        };

        const { error: updateError } = await supabase
            .from('media')
            .update({ metadata: updatedMetadata })
            .eq('id', mediaId);

        if (updateError) throw updateError;

        await safeAudit(req.user.id, 'MEDIA_LINK_EVENT', 'media', mediaId, req, {
            family_space_id: context.familySpaceId,
            event_id: eventId
        });

        res.json({ message: 'Media linked to event successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminModeration = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        let query = supabase.from('abuse_reports').select('*');

        if (req.query.status && req.query.status !== 'all') {
            query = query.eq('status', req.query.status);
        }

        const { data: reports, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        
        if (!reports || reports.length === 0) {
            return res.json({ family_space_id: context.familySpaceId, reports: [] });
        }

        const userIds = [...new Set([
            ...reports.map(r => r.reporter_id),
            ...reports.map(r => r.resolved_by)
        ].filter(Boolean))];

        const { data: usersData } = await supabase
            .from('users')
            .select('id, first_name, last_name, email')
            .in('id', userIds);

        const userMap = (usersData || []).reduce((acc, u) => {
            acc[u.id] = u;
            return acc;
        }, {});

        const enrichedReports = reports.map(r => ({
            ...r,
            reporter: userMap[r.reporter_id] || null,
            assigned_to_user: userMap[r.resolved_by] || null
        }));

        res.json({ family_space_id: context.familySpaceId, reports: enrichedReports });
    } catch (err) {
        console.error('>>> GET MODERATION REPORTS ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const resolveFamilyAdminModeration = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res, OWNER_ROLES);
        if (!context) return;

        const { reportId } = req.params;
        const { action, notes } = req.body;

        const { data: report, error: reportError } = await supabase
            .from('abuse_reports')
            .select('*')
            .eq('id', reportId)
            .single();

        if (reportError) throw reportError;
        if (!report) return res.status(404).json({ error: 'Moderation report not found' });

        const normalizedAction = normalizeRole(action);
        
        // Execute punitive actions if applicable
        if (normalizedAction === 'remove_content') {
            if (report.target_type === 'post') {
                await supabase.from('posts').update({ deleted_at: new Date().toISOString() }).eq('id', report.target_id);
            } else if (report.target_type === 'media') {
                await supabase.from('media').update({ is_deleted: true }).eq('id', report.target_id);
            }
        } else if (normalizedAction === 'suspend_account') {
            // Find the user responsible and suspend
            const { data: targetUser } = await supabase.from('users').select('id').eq('id', report.target_id).maybeSingle();
            if (targetUser) await supabase.from('users').update({ status: 'suspended' }).eq('id', targetUser.id);
        } else if (normalizedAction === 'warn_user') {
            // Find the user and send warning
            const targetUserId = report.target_type === 'person' || report.target_type === 'user' ? report.target_id : null;
            if (targetUserId) {
                await supabase.from('notifications').insert({
                    user_id: targetUserId,
                    type: 'moderation_warning',
                    title: 'Content warning',
                    message: notes || 'A family admin reviewed your content.'
                });
            }
        } else if (normalizedAction !== 'dismiss') {
            return res.status(400).json({ error: 'Invalid moderation action' });
        }

        const { data, error } = await supabase
            .from('abuse_reports')
            .update({
                status: normalizedAction === 'dismiss' ? 'dismissed' : 'resolved',
                resolution_notes: notes || normalizedAction,
                resolved_by: req.user.id,
                resolved_at: new Date().toISOString()
            })
            .eq('id', reportId)
            .select()
            .single();

        if (error) throw error;

        await safeAudit(req.user.id, `FAMILY_MODERATION_${normalizedAction}`, 'abuse_reports', reportId, req, {
            family_space_id: context.familySpaceId,
            notes: notes || null
        });

        try {
            const { dispatchNotification } = await import('../../services/notificationService.js');
            dispatchNotification(
                context.familySpaceId,
                'Abuse report',
                `Moderation ${normalizedAction}`,
                notes || `An abuse report was ${normalizedAction === 'dismiss' ? 'dismissed' : 'resolved'}.`,
                undefined,
                { channel: 'abuse' }
            ).catch(() => {});
        } catch (_) { /* non-blocking */ }

        res.json({ message: 'Moderation report resolved', report: data });
    } catch (err) {
        console.error('>>> RESOLVE MODERATION ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminRoles = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { familySpaceId, role: actorRole } = context;
        const { data: memberships, error } = await supabase
            .from('family_memberships')
            .select('role, branch_id')
            .eq('family_space_id', familySpaceId);
        if (error) throw error;

        const { data: labels } = await supabase
            .from('family_custom_labels')
            .select('role_key, custom_label')
            .eq('family_space_id', familySpaceId);

        const labelMap = {};
        (labels || []).forEach((label) => {
            labelMap[normalizeFamilyRole(label.role_key)] = label.custom_label;
        });

        const roleDefaults = Object.values(FAMILY_ROLE_META);

        const roles = roleDefaults.map((role) => ({
            ...role,
            role: role.label,
            display_name: labelMap[role.key] || role.label,
            active_members: (memberships || []).filter((m) => normalizeFamilyRole(m.role) === role.key).length,
            description:
                role.key === 'editor'
                    ? 'Content / advisory role (UI may show as Council Elder). Not a separate product panel.'
                    : role.key === 'family-admin'
                        ? 'Operational admin. Cannot override Family Owner.'
                        : role.key === 'owner'
                            ? 'Highest family authority. Ownership transfer is a separate flow.'
                            : 'Standard access level for this role.'
        }));

        const { data: space } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', familySpaceId)
            .single();

        const adminDelegations = readAdminDelegations(space?.settings);
        const settings = {
            hideSubBranches: false,
            allowLineageMerge: true,
            visibility: 'All family members',
            ...(space?.settings?.governance || {}),
            adminDelegations
        };

        res.json({
            family_space_id: familySpaceId,
            actor_role: normalizeFamilyRole(actorRole),
            can_manage_roles: canManageFamilyRoles(actorRole),
            assignable_roles: getAssignableRoles(actorRole, adminDelegations).map((key) => ({
                key,
                ...(FAMILY_ROLE_META[key] || { key, label: key })
            })),
            roles,
            settings
        });
    } catch (err) {
        console.error('>>> GET ROLES ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const updateFamilyRoleSettings = async (req, res) => {
    try {
        // Owner always; Family Admin only if delegated canModifyGovernanceRules
        const context = await requireFamilyAdmin(req, res, [...OWNER_ROLES, 'admin', 'family-admin', 'family_admin', 'co-admin']);
        if (!context) return;

        const actor = normalizeFamilyRole(context.role);
        const {
            hideSubBranches,
            allowLineageMerge,
            visibility,
            adminDelegations
        } = req.body;

        const { data: spaceData, error: spaceError } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', context.familySpaceId)
            .single();

        if (spaceError) throw spaceError;

        const prevDelegations = readAdminDelegations(spaceData.settings);

        if (actor !== 'owner') {
            if (!prevDelegations.canModifyGovernanceRules) {
                return res.status(403).json({ error: 'Only Family Owner can update governance settings unless delegated.' });
            }
        }

        const nextDelegations = (actor === 'owner' && adminDelegations)
            ? { ...DEFAULT_ADMIN_DELEGATIONS, ...prevDelegations, ...adminDelegations }
            : prevDelegations;

        const updatedSettings = {
            ...(spaceData.settings || {}),
            governance: {
                hideSubBranches,
                allowLineageMerge,
                visibility,
                adminDelegations: nextDelegations
            }
        };

        const { data, error } = await supabase
            .from('family_spaces')
            .update({ settings: updatedSettings })
            .eq('id', context.familySpaceId)
            .select()
            .single();

        if (error) throw error;

        await safeAudit(req.user.id, 'FAMILY_ROLE_SETTINGS_UPDATE', 'family_spaces', context.familySpaceId, req, {
            hideSubBranches,
            allowLineageMerge,
            visibility,
            adminDelegations: nextDelegations,
            actor_role: actor
        });
        res.json({
            message: 'Family role settings recorded',
            family_space_id: context.familySpaceId,
            space: data,
            admin_delegations: nextDelegations
        });
    } catch (err) {
        console.error('>>> UPDATE ROLE SETTINGS ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const initiateOwnershipTransfer = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data: membership, error: membershipError } = await supabase
            .from('family_memberships')
            .select('role')
            .eq('family_space_id', context.familySpaceId)
            .eq('user_id', req.user.id)
            .single();

        if (membershipError || !membership || membership.role !== 'owner') {
            return res.status(403).json({ error: 'Global transfer is restricted to the root owner.' });
        }

        const { newOwnerId, target_user_id } = req.body;
        const nextOwnerId = newOwnerId || target_user_id;
        if (!nextOwnerId) return res.status(400).json({ error: 'newOwnerId is required' });

        // Verify the new owner is an active member
        const { data: newOwnerMembership, error: newOwnerError } = await supabase
            .from('family_memberships')
            .select('id, role')
            .eq('family_space_id', context.familySpaceId)
            .eq('user_id', nextOwnerId)
            .single();

        if (newOwnerError || !newOwnerMembership) {
            return res.status(404).json({ error: 'Selected member is not part of this family space.' });
        }

        if (nextOwnerId === req.user.id) {
            return res.status(400).json({ error: 'Cannot transfer ownership to yourself.' });
        }

        // 0. Update family_spaces.owner_id
        const { error: spaceOwnerError } = await supabase
            .from('family_spaces')
            .update({ owner_id: nextOwnerId })
            .eq('id', context.familySpaceId);
        if (spaceOwnerError) throw new Error('Failed to update space owner: ' + spaceOwnerError.message);

        // 1. Demote current owner to family-admin
        const { error: demoteError } = await supabase
            .from('family_memberships')
            .update({ role: 'family-admin' })
            .eq('family_space_id', context.familySpaceId)
            .eq('user_id', req.user.id);

        if (demoteError) throw new Error('Failed to demote current owner: ' + demoteError.message);

        // 2. Promote new owner to owner
        const { error: promoteError } = await supabase
            .from('family_memberships')
            .update({ role: 'owner' })
            .eq('family_space_id', context.familySpaceId)
            .eq('user_id', nextOwnerId);

        if (promoteError) throw new Error('Failed to promote new owner: ' + promoteError.message);

        await safeAudit(req.user.id, 'TRANSFER_OWNERSHIP_COMPLETED', 'family_spaces', context.familySpaceId, req, {
            previous_owner_id: req.user.id,
            new_owner_id: nextOwnerId
        });

        res.json({ message: 'Ownership transferred successfully. You have been demoted to Family Admin.' });
    } catch (err) {
        console.error('>>> INITIATE TRANSFER ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminNotificationPolicies = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data: spaceData, error: spaceError } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', context.familySpaceId)
            .single();

        if (spaceError) throw spaceError;

        const {
            POLICY_CATALOG,
            mergePoliciesWithDefaults
        } = await import('../../services/notificationService.js');
        const { isEmailConfigured } = await import('../../services/emailService.js');

        const policies = mergePoliciesWithDefaults(spaceData.settings?.notification_policies);

        res.json({
            family_space_id: context.familySpaceId,
            catalog: POLICY_CATALOG,
            policies,
            email_configured: isEmailConfigured(),
            recipient_role_options: ['owner', 'family-admin', 'co-admin', 'branch-admin', 'editor', 'member']
        });
    } catch (err) {
        console.error('>>> GET NOTIFICATION POLICIES ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const updateFamilyAdminNotificationPolicies = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { policies } = req.body;
        const { mergePoliciesWithDefaults } = await import('../../services/notificationService.js');

        const { data: spaceData, error: spaceError } = await supabase
            .from('family_spaces')
            .select('settings')
            .eq('id', context.familySpaceId)
            .single();

        if (spaceError) throw spaceError;

        const updatedSettings = {
            ...(spaceData.settings || {}),
            notification_policies: mergePoliciesWithDefaults(policies || {})
        };

        const { data, error } = await supabase
            .from('family_spaces')
            .update({ settings: updatedSettings })
            .eq('id', context.familySpaceId)
            .select()
            .single();

        if (error) throw error;

        await safeAudit(req.user.id, 'UPDATE_NOTIFICATION_POLICIES', 'family_spaces', context.familySpaceId, req, {
            policies: updatedSettings.notification_policies
        });

        res.json({
            message: 'Notification policies updated successfully',
            space: data,
            policies: updatedSettings.notification_policies
        });
    } catch (err) {
        console.error('>>> UPDATE NOTIFICATION POLICIES ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const testFamilyAdminNotificationPolicy = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { action } = req.body;
        if (!action) return res.status(400).json({ error: 'action is required' });

        const { testNotificationPolicy } = await import('../../services/notificationService.js');
        const result = await testNotificationPolicy(context.familySpaceId, action, req.user.id);

        await safeAudit(req.user.id, 'TEST_NOTIFICATION_POLICY', 'family_spaces', context.familySpaceId, req, {
            action,
            result
        });

        res.json({ message: 'Test notification dispatched', result });
    } catch (err) {
        console.error('>>> TEST NOTIFICATION POLICY ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminNotificationLogs = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { getNotificationDeliveryLogs } = await import('../../services/notificationService.js');
        const logs = await getNotificationDeliveryLogs(context.familySpaceId, Number(req.query.limit) || 50);
        res.json({ family_space_id: context.familySpaceId, logs });
    } catch (err) {
        console.error('>>> GET NOTIFICATION LOGS ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminNotifications = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data, error } = await supabase
            .from('notifications')
            .select('*')
            .eq('user_id', req.user.id)
            .order('created_at', { ascending: false })
            .limit(Number(req.query.limit) || 50);

        if (error) throw error;

        res.json({
            family_space_id: context.familySpaceId,
            notifications: data || [],
            unread: (data || []).filter((n) => !n.read_at).length
        });
    } catch (err) {
        console.error('>>> GET NOTIFICATIONS ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const markFamilyAdminNotificationRead = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { notificationId } = req.params;
        const { data, error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', notificationId)
            .eq('user_id', req.user.id)
            .select()
            .single();

        if (error) throw error;
        res.json({ message: 'Notification marked as read', notification: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const markAllFamilyAdminNotificationsRead = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { error } = await supabase
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', req.user.id)
            .is('read_at', null);

        if (error) throw error;
        res.json({ message: 'All notifications marked as read' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const createSupportTicket = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { category, title, description, attachment_url } = req.body;

        if (!category || !title || !description) {
            return res.status(400).json({ error: 'Category, title, and description are required.' });
        }

        const { data, error } = await supabase
            .from('support_tickets')
            .insert({
                user_id: req.user.id,
                family_space_id: context.familySpaceId,
                category,
                subject: title,
                description,
                attachment_url: attachment_url || null,
                status: 'open'
            })
            .select()
            .single();

        if (error) throw error;

        // Seed thread so Family Admin & Business see the original report in messages
        try {
            await supabase.from('ticket_messages').insert({
                ticket_id: data.id,
                sender_id: req.user.id,
                message: description,
                is_internal: false
            });
        } catch (_) { /* optional if constraint differs */ }

        await safeAudit(req.user.id, 'CREATE_SUPPORT_TICKET', 'support_tickets', data.id, req, {
            category,
            title
        });

        const { dispatchNotification } = await import('../../services/notificationService.js');
        await dispatchNotification(
            context.familySpaceId,
            'New support ticket',
            `Support ticket: ${title}`,
            `${category} — ${description}`,
            undefined,
            { extraUserIds: [req.user.id] }
        );

        res.status(201).json({ message: 'Support ticket created successfully', ticket: data });
    } catch (err) {
        console.error('>>> CREATE SUPPORT TICKET ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminSupportKnowledge = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { mergeSupportKnowledge, getDefaultSupportKnowledge } = await import('../../services/supportKnowledgeService.js');
        try {
            const { data, error } = await supabase
                .from('platform_settings')
                .select('value')
                .eq('key', 'support_knowledge')
                .maybeSingle();
            if (error) console.warn('[getFamilyAdminSupportKnowledge]', error.message);
            return res.json({
                knowledge: mergeSupportKnowledge(data?.value || {}),
                source: data?.value ? 'cms' : 'defaults'
            });
        } catch (_) {
            return res.json({ knowledge: getDefaultSupportKnowledge(), source: 'defaults' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const listFamilyAdminSupportTickets = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { data, error } = await supabase
            .from('support_tickets')
            .select(`
                id, category, subject, description, status, priority, attachment_url,
                created_at, user_id, family_space_id,
                user:users!user_id (id, first_name, last_name, email)
            `)
            .eq('family_space_id', context.familySpaceId)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ family_space_id: context.familySpaceId, tickets: data || [] });
    } catch (err) {
        console.error('>>> LIST FAMILY SUPPORT TICKETS ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const getFamilyAdminSupportTicket = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { ticketId } = req.params;
        const { data: ticket, error: ticketError } = await supabase
            .from('support_tickets')
            .select(`
                *,
                user:users!user_id (id, first_name, last_name, email)
            `)
            .eq('id', ticketId)
            .eq('family_space_id', context.familySpaceId)
            .single();

        if (ticketError || !ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        const { data: messages, error: msgError } = await supabase
            .from('ticket_messages')
            .select(`
                id, ticket_id, sender_id, message, is_internal, created_at,
                sender:users!sender_id (id, first_name, last_name, avatar_url, email)
            `)
            .eq('ticket_id', ticketId)
            .eq('is_internal', false)
            .order('created_at', { ascending: true });

        if (msgError) throw msgError;

        res.json({ ...ticket, messages: messages || [] });
    } catch (err) {
        console.error('>>> GET FAMILY SUPPORT TICKET ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const replyFamilyAdminSupportTicket = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        const { ticketId } = req.params;
        const { message } = req.body;
        if (!message || !String(message).trim()) {
            return res.status(400).json({ error: 'message is required' });
        }

        const { data: ticket, error: ticketError } = await supabase
            .from('support_tickets')
            .select('id, subject, status, user_id, family_space_id')
            .eq('id', ticketId)
            .eq('family_space_id', context.familySpaceId)
            .single();

        if (ticketError || !ticket) {
            return res.status(404).json({ error: 'Ticket not found' });
        }

        if (['closed'].includes(String(ticket.status || '').toLowerCase())) {
            return res.status(400).json({ error: 'Cannot reply to a closed ticket' });
        }

        const { data: msg, error: msgError } = await supabase
            .from('ticket_messages')
            .insert({
                ticket_id: ticketId,
                sender_id: req.user.id,
                message: String(message).trim(),
                is_internal: false
            })
            .select(`
                id, ticket_id, sender_id, message, is_internal, created_at,
                sender:users!sender_id (id, first_name, last_name, avatar_url, email)
            `)
            .single();

        if (msgError) throw msgError;

        if (String(ticket.status).toLowerCase() === 'resolved') {
            await supabase.from('support_tickets').update({ status: 'open' }).eq('id', ticketId);
        }

        const { dispatchNotification } = await import('../../services/notificationService.js');
        dispatchNotification(
            context.familySpaceId,
            'Support ticket updated',
            `Support ticket reply: ${ticket.subject || ticketId}`,
            String(message).trim(),
            undefined,
            { extraUserIds: ticket.user_id ? [ticket.user_id] : [] }
        ).catch(() => {});

        await safeAudit(req.user.id, 'REPLY_SUPPORT_TICKET', 'support_tickets', ticketId, req, {
            preview: String(message).slice(0, 120)
        });

        res.status(201).json({ message: 'Reply sent', reply: msg });
    } catch (err) {
        console.error('>>> REPLY FAMILY SUPPORT TICKET ERROR:', err);
        res.status(500).json({ error: err.message });
    }
};

export const uploadFamilyAdminSupportAttachment = async (req, res) => {
    try {
        const context = await requireFamilyAdmin(req, res);
        if (!context) return;

        if (!req.file) {
            return res.status(400).json({ error: 'file is required' });
        }

        const safeName = String(req.file.originalname || 'attachment')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .slice(0, 80);
        const path = `support/${context.familySpaceId}/${Date.now()}-${safeName}`;
        const url = await uploadFile(
            BUCKETS.MEDIA,
            path,
            req.file.buffer,
            req.file.mimetype,
            context.familySpaceId,
            req.user.id
        );

        res.status(201).json({
            message: 'Attachment uploaded',
            attachment_url: url,
            path,
            mime: req.file.mimetype,
            size: req.file.size
        });
    } catch (err) {
        console.error('>>> UPLOAD SUPPORT ATTACHMENT ERROR:', err);
        const status = err.message === 'STORAGE_LIMIT_EXCEEDED' ? 413 : 500;
        res.status(status).json({ error: err.message });
    }
};

export const getFamilyAdminBranchApprovals = async (req, res) => {
    try {
        const { familySpaceId } = req.params;
        const { status } = req.query; // 'pending', 'approved', 'rejected'

        let query = supabase
            .from('branch_edit_requests')
            .select(`
                *,
                user:requested_by(first_name, last_name, email, avatar_url),
                branch:branch_id(name)
            `)
            .eq('family_space_id', familySpaceId);
            
        if (status && status !== 'all') {
            query = query.eq('status', status);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const resolveFamilyAdminBranchApproval = async (req, res) => {
    try {
        const { familySpaceId, approvalId } = req.params;
        const { action, reviewer_comment } = req.body; // 'approved' or 'rejected'
        const { user } = req;

        const { data: request, error: reqError } = await supabase
            .from('branch_edit_requests')
            .select('*')
            .eq('id', approvalId)
            .eq('family_space_id', familySpaceId)
            .single();

        if (reqError) throw reqError;
        if (request.status !== 'pending') return res.status(400).json({ error: 'Request is already ' + request.status });

        if (action === 'approved') {
            if (request.request_type === 'edit_member') {
                const { id: personId, fatherId, motherId, spouseId, childrenIds, branch_id, family_space_id, created_at, updated_at, claimed_by, ...personUpdates } = request.proposed_value;
                const { error: updateError } = await supabase
                    .from('persons')
                    .update(personUpdates)
                    .eq('id', request.current_value.id);
                if (updateError) throw updateError;
                await logActivity(user.id, 'APPROVE_MEMBER_EDIT', 'persons', request.current_value.id, familySpaceId);
            } else if (['add_parent', 'add_child', 'add_family_member'].includes(request.request_type)) {
                // Shared logic for creating a new person from proposed_value
                const {
                    target_person_id, relationship_type, link_existing_id,
                    ...personData
                } = request.proposed_value;

                // Strip fields that shouldn't go to persons table directly
                const cleanPersonData = { ...personData };
                delete cleanPersonData.target_person_id;
                delete cleanPersonData.relationship_type;
                delete cleanPersonData.link_existing_id;
                
                cleanPersonData.family_space_id = familySpaceId;
                if (cleanPersonData.first_name && cleanPersonData.last_name) {
                    cleanPersonData.full_name = `${cleanPersonData.first_name} ${cleanPersonData.last_name}`.trim();
                }

                let newPersonId = link_existing_id;

                if (!newPersonId) {
                    const { data: newPerson, error: pError } = await supabase
                        .from('persons')
                        .insert(cleanPersonData)
                        .select()
                        .single();
                    if (pError) throw pError;
                    newPersonId = newPerson.id;
                }

                // Handle Relationship Edge
                if (target_person_id) {
                    const { data: targetPerson } = await supabase.from('persons').select('clan_tree_id').eq('id', target_person_id).single();
                    
                    let rType = 'parent';
                    let p1 = newPersonId;
                    let p2 = target_person_id;

                    if (request.request_type === 'add_child') {
                        p1 = target_person_id;
                        p2 = newPersonId;
                    } else if (request.request_type === 'add_family_member' && relationship_type) {
                        let type = relationship_type.toLowerCase();
                        if (type === 'child') {
                            p1 = target_person_id;
                            p2 = newPersonId;
                            type = 'parent';
                        } else {
                            rType = type;
                        }
                    }

                    const { error: rError } = await supabase
                        .from('person_relations')
                        .insert({
                            clan_tree_id: targetPerson?.clan_tree_id || null,
                            person_id_1: p1,
                            person_id_2: p2,
                            relation_type: rType
                        });
                    if (rError) throw rError;

                    if (targetPerson?.clan_tree_id) {
                        await supabase.from('persons').update({ clan_tree_id: targetPerson.clan_tree_id }).eq('id', newPersonId);
                    }
                }
                await logActivity(user.id, `APPROVE_${request.request_type.toUpperCase()}`, 'persons', newPersonId, familySpaceId);
            } else {
                // Apply the changes to the branch
                const updates = request.proposed_value;
                const branchId = request.branch_id;
                
                const { error: updateError } = await supabase
                    .from('family_branches')
                    .update(updates)
                    .eq('id', branchId);

                if (updateError) throw updateError;
                await logActivity(user.id, 'APPROVE_BRANCH_EDIT', 'family_branches', branchId, familySpaceId);
            }
        } else if (action === 'rejected') {
            await logActivity(user.id, `REJECT_${request.request_type.toUpperCase()}`, 'branch_edit_requests', approvalId, familySpaceId);
            
            // Notification to original requester
            if (request.requested_by) {
                await supabase.from('notifications').insert({
                    user_id: request.requested_by,
                    family_space_id: familySpaceId,
                    type: 'request_rejected',
                    title: 'Update Request Rejected',
                    message: `Your request to ${request.request_type.replace('_', ' ')} was rejected by an admin. Reason: ${reviewer_comment || 'No reason provided.'}`
                });
            }
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }

        // Update the request status
        const { data: updatedReq, error: updReqError } = await supabase
            .from('branch_edit_requests')
            .update({ 
                status: action,
                reviewer_id: user.id,
                reviewer_comment: reviewer_comment || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', approvalId)
            .select()
            .single();
            
        if (updReqError) throw updReqError;

        res.json(updatedReq);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
