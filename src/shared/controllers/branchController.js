import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';
import { uploadFile, BUCKETS } from '../../config/storageClient.js';
import { getGovernancePermissions } from '../../utils/familyGovernancePolicy.js';
import { normalizeFamilyRole } from '../../utils/familyRolePolicy.js';

/**
 * Resolves a provided ID (which could be a Person ID or a User ID) to a valid Person ID.
 * If it's a User ID that hasn't claimed a person yet, it creates a new person node.
 */
const resolvePersonId = async (input_id, family_space_id) => {
    if (!input_id || input_id === 'null' || input_id === '[object Object]') return null;

    // 1. Check if it's already a valid Person ID
    const { data: person } = await supabase
        .from('persons')
        .select('id')
        .eq('id', input_id)
        .maybeSingle();

    if (person) return person.id;

    // 2. Check if it's a User ID
    const { data: user } = await supabase
        .from('users')
        .select('id, first_name, last_name, avatar_url')
        .eq('id', input_id)
        .maybeSingle();

    if (user) {
        // 2a. Check if they've claimed a person since search
        const { data: claimed } = await supabase
            .from('persons')
            .select('id')
            .eq('claimed_by', user.id)
            .maybeSingle();

        if (claimed) return claimed.id;

        // 2b. Auto-create a person node for this member so they exist in the tree
        // We find the first tree in this space to attach them to
        const { data: tree } = await supabase
            .from('clan_trees')
            .select('id')
            .eq('family_space_id', family_space_id)
            .limit(1)
            .maybeSingle();

        const { data: newPerson, error: pError } = await supabase
            .from('persons')
            .insert({
                family_space_id,
                clan_tree_id: tree?.id || null,
                full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'System Admin',
                first_name: user.first_name,
                last_name: user.last_name,
                avatar_url: user.avatar_url,
                claimed_by: user.id,
                status: 'active'
            })
            .select('id')
            .single();

        if (!pError && newPerson) return newPerson.id;
    }

    return input_id; // Fallback to original (might cause FK error if invalid, but safest)
};

const validateBranchAdminEmail = async (adminId) => {
    if (!adminId || adminId === 'null' || adminId === '[object Object]') return true;

    const { data: person } = await supabase
        .from('persons')
        .select('id, email, claimed_by')
        .or(`id.eq.${adminId},claimed_by.eq.${adminId}`)
        .maybeSingle();

    let userId = person?.claimed_by || null;
    let email = person?.email || null;

    if (!userId) {
        const { data: userRecord } = await supabase
            .from('users')
            .select('id, email')
            .eq('id', adminId)
            .maybeSingle();
        if (userRecord) {
            userId = userRecord.id;
            email = userRecord.email || email;
        }
    } else if (!email) {
        const { data: userRecord } = await supabase
            .from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();
        if (userRecord?.email) {
            email = userRecord.email;
        }
    }

    if (!email || email.trim() === '') {
        throw new Error('Selected Branch Admin has no email address found. An email address is required to assign a Branch Admin.');
    }
    return true;
};

const validateAndAssignBranchAdmin = async (branchId, familySpaceId, newAdminId, oldAdminId = null) => {
    const sanitize = (val) => (val === '' || val === 'null' || val === '[object Object]') ? null : val;
    newAdminId = sanitize(newAdminId);
    oldAdminId = sanitize(oldAdminId);

    if (!newAdminId) {
        if (oldAdminId) {
            await supabase.from('family_memberships').update({
                role: 'member',
                branch_id: null
            }).eq('family_space_id', familySpaceId).eq('user_id', oldAdminId).eq('role', 'branch-admin');

            await supabase.from('family_space_staff').delete()
                .eq('family_space_id', familySpaceId).eq('user_id', oldAdminId).eq('role', 'manager');

            await supabase.from('admin_users').delete()
                .eq('user_id', oldAdminId).eq('role', 'branch-admin');
        }
        return null;
    }

    const { data: person } = await supabase
        .from('persons')
        .select('id, email, claimed_by, first_name, last_name, full_name')
        .or(`id.eq.${newAdminId},claimed_by.eq.${newAdminId}`)
        .maybeSingle();

    let userId = person?.claimed_by || null;
    let personId = person?.id || null;
    let email = person?.email || null;

    if (!userId) {
        const { data: userRecord } = await supabase
            .from('users')
            .select('id, email, first_name, last_name')
            .eq('id', newAdminId)
            .maybeSingle();
        if (userRecord) {
            userId = userRecord.id;
            email = userRecord.email || email;
        }
    } else if (!email) {
        const { data: userRecord } = await supabase
            .from('users')
            .select('email')
            .eq('id', userId)
            .maybeSingle();
        if (userRecord?.email) {
            email = userRecord.email;
        }
    }

    if (!email || email.trim() === '') {
        throw new Error('Selected Branch Admin has no email address found. An email address is required to assign a Branch Admin.');
    }

    const cleanEmail = email.trim();

    try {
        const { data: inviteRes, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(cleanEmail, {
            data: {
                first_name: person?.first_name || 'Branch Admin',
                role: 'branch-admin',
                family_space_id: familySpaceId
            },
            redirectTo: `${process.env.FRONTEND_URL || 'https://kincore-tree.vercel.app'}/accept-invite`
        });
        if (inviteRes?.user?.id && !userId) {
            userId = inviteRes.user.id;
        }
        if (inviteErr) {
            console.log(`[BRANCH_ADMIN_ASSIGN] Invite notice (${inviteErr.message}), sending login magic link to ${cleanEmail}...`);
            await supabase.auth.signInWithOtp({
                email: cleanEmail,
                options: {
                    emailRedirectTo: `${process.env.FRONTEND_URL || 'https://kincore-tree.vercel.app'}/accept-invite`
                }
            });
        } else {
            console.log(`[BRANCH_ADMIN_ASSIGN] Successfully fired invite email to ${cleanEmail}`);
        }
    } catch (e) {
        console.error('[BRANCH_ADMIN_ASSIGN] Invite error:', e);
    }

    if (!userId) {
        const { data: matchedUser } = await supabase.from('users').select('id').ilike('email', cleanEmail).maybeSingle();
        if (matchedUser) {
            userId = matchedUser.id;
        }
    }

    if (oldAdminId && oldAdminId !== userId && oldAdminId !== personId && oldAdminId !== newAdminId) {
        await supabase.from('family_memberships').update({
            role: 'member',
            branch_id: null
        }).eq('family_space_id', familySpaceId).eq('user_id', oldAdminId).eq('role', 'branch-admin');

        await supabase.from('family_space_staff').delete()
            .eq('family_space_id', familySpaceId).eq('user_id', oldAdminId).eq('role', 'manager');

        await supabase.from('admin_users').delete()
            .eq('user_id', oldAdminId).eq('role', 'branch-admin');
    }

    if (userId) {
        if (personId) {
            await supabase.from('persons').update({
                claimed_by: userId,
                role: 'branch-admin',
                pending_role: 'branch-admin',
                member_status: 'invitation_pending',
                branch_id: branchId,
                email: cleanEmail
            }).eq('id', personId);
        }

        await supabase.from('family_memberships').upsert({
            user_id: userId,
            family_space_id: familySpaceId,
            role: 'branch-admin',
            status: 'active',
            branch_id: branchId
        }, { onConflict: 'user_id,family_space_id' });

        await supabase.from('family_space_staff').upsert({
            family_space_id: familySpaceId,
            user_id: userId,
            role: 'manager',
            is_active: true
        }, { onConflict: 'family_space_id,user_id' });

        await supabase.from('admin_users').upsert({
            user_id: userId,
            role: 'branch-admin'
        }, { onConflict: 'user_id' });
    } else if (personId) {
        await supabase.from('persons').update({
            role: 'branch-admin',
            pending_role: 'branch-admin',
            member_status: 'invitation_pending',
            branch_id: branchId,
            email: cleanEmail
        }).eq('id', personId);
    }

    return userId || personId || newAdminId;
};


/**
 * Check if the family space has reached its branch limit.
 */
export const getBranchLimitStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const { data: config } = await supabase
            .from('system_configs')
            .select('value')
            .eq('key', 'max_branches_default')
            .single();
        
        let rawVal = config?.value;
        if (typeof rawVal === 'string' && rawVal.startsWith('"')) rawVal = rawVal.replace(/^"|"$/g, '');
        const maxBranches = parseInt(rawVal, 10) || 50;

        const { count: branchCount } = await supabase
            .from('family_branches')
            .select('*', { count: 'exact', head: true })
            .eq('family_space_id', id);

        res.json({
            current_branches: branchCount || 0,
            max_branches: maxBranches,
            limit_reached: (branchCount || 0) >= maxBranches
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * List all branches for a family space.
 */
export const getBranches = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Fetch branches
        const { data: branches, error: bError } = await supabase
            .from('family_branches')
            .select('*')
            .eq('family_space_id', id)
            .order('name', { ascending: true });

        if (bError) throw bError;

        // 2. Fetch all related persons in one go for efficiency
        const personIds = Array.from(new Set(branches?.map(b => [b.head_person_id, b.root_person_id, b.branch_admin_id]).flat().filter(id => id)));
        const { data: leaders } = personIds.length > 0
            ? await supabase.from('persons').select('id, full_name').in('id', personIds)
            : { data: [] };

        const leaderMap = {};
        (leaders || []).forEach(l => { leaderMap[l.id] = l.full_name; });

        // 3. Count total members per branch
        const enrichedBranches = await Promise.all((branches || []).map(async (branch) => {
            const { count: memberCount } = await supabase
                .from('persons')
                .select('*', { count: 'exact', head: true })
                .eq('branch_id', branch.id);

            return {
                ...branch,
                leader_name: leaderMap[branch.head_person_id] || leaderMap[branch.branch_admin_id] || 'No Head Set',
                member_count: memberCount || 0,
                household_count: Math.ceil((memberCount || 0) / 3),
                generation_count: 1,
                emblem: branch.emblem_url || '🌲'
            };
        }));

        res.set({
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
        });
        res.json(enrichedBranches);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Create a new branch.
 */
export const createBranch = async (req, res) => {
    try {
        let {
            family_space_id, name, description, region,
            root_person_id, head_person_id, branch_admin_id,
            founding_year, migration_origin,
            visibility, invite_policy,
            can_add_members, can_edit_history, can_upload_media
        } = req.body;
        const { user } = req;

        // --- Check Branch Limit ---
        const { data: config } = await supabase
            .from('system_configs')
            .select('value')
            .eq('key', 'max_branches_default')
            .single();
        
        let rawVal = config?.value;
        if (typeof rawVal === 'string' && rawVal.startsWith('"')) rawVal = rawVal.replace(/^"|"$/g, '');
        const maxBranches = parseInt(rawVal, 10) || 50;

        const { count: branchCount } = await supabase
            .from('family_branches')
            .select('*', { count: 'exact', head: true })
            .eq('family_space_id', family_space_id);

        if (branchCount >= maxBranches) {
            return res.status(403).json({ 
                error: 'MAX_BRANCHES_EXCEEDED', 
                message: `Cannot create branch. Maximum limit of ${maxBranches} branches reached for this space.` 
            });
        }
        // --------------------------

        // Resolve Virtual Nodes (User IDs) to real Person IDs
        root_person_id = await resolvePersonId(root_person_id, family_space_id);
        head_person_id = await resolvePersonId(head_person_id, family_space_id);

        // Sanitize UUIDs/Numbers (Handle empty strings)
        const sanitize = (val) => (val === '' || val === 'null' || val === '[object Object]') ? null : val;

        root_person_id = sanitize(root_person_id);
        head_person_id = sanitize(head_person_id);
        branch_admin_id = sanitize(branch_admin_id);
        const fYear = sanitize(founding_year);

        let emblem_url = req.body.emblem_url || null;

        if (req.file) {
            const ext = req.file.originalname.split('.').pop().toLowerCase();
            const path = `${family_space_id}/branch-emblem-${Date.now()}.${ext}`;
            emblem_url = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype);
        }

        if (branch_admin_id) {
            await validateBranchAdminEmail(branch_admin_id);
        }

        const { data, error } = await supabase
            .from('family_branches')
            .insert({
                family_space_id,
                name,
                description,
                region,
                root_person_id,
                head_person_id,
                founding_year: fYear,
                migration_origin,
                emblem_url,
                visibility: visibility || 'family',
                invite_policy: invite_policy || 'admin_approval',
                can_add_members: can_add_members || 'head_only',
                can_edit_history: can_edit_history || 'head_only',
                can_upload_media: can_upload_media || 'all_members'
            })
            .select()
            .single();

        if (error) throw error;

        // Automatically link the selected Root Ancestor and Branch Head to this branch
        const personsToLink = [data.root_person_id, data.head_person_id].filter(Boolean);
        if (personsToLink.length > 0) {
            await supabase.from('persons').update({ branch_id: data.id }).in('id', personsToLink);
        }

        if (branch_admin_id) {
            const resolvedAdminId = await validateAndAssignBranchAdmin(data.id, family_space_id, branch_admin_id, null);
            if (resolvedAdminId && resolvedAdminId !== data.branch_admin_id) {
                await supabase.from('family_branches').update({ branch_admin_id: resolvedAdminId }).eq('id', data.id);
                data.branch_admin_id = resolvedAdminId;
            }
        }

        await logActivity(user.id, 'CREATE_BRANCH', 'family_branches', data.id, family_space_id, {
            branch_name: data.name,
            branch_code: data.code,
            branch_admin_id: data.branch_admin_id || 'unassigned',
            root_person_id: data.root_person_id || 'unassigned',
            head_person_id: data.head_person_id || 'unassigned',
            diff: {
                status: { old: 'none', new: 'active' },
                branch_name: { old: 'none', new: data.name }
            }
        });

        const { dispatchNotification } = await import('../../services/notificationService.js');
        dispatchNotification(
            family_space_id,
            'New group created',
            'New branch created',
            `Branch "${data.name}" was created.`
        ).catch(() => {});

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Delete a branch.
 */
export const deleteBranch = async (req, res) => {
    try {
        const { id } = req.params;
        const { user } = req;

        const { data: branch } = await supabase
            .from('family_branches')
            .select('family_space_id, name, code')
            .eq('id', id)
            .single();

        if (branch?.family_space_id) {
            const perms = await getGovernancePermissions(branch.family_space_id);
            const { data: membership } = await supabase
                .from('family_memberships')
                .select('role')
                .eq('family_space_id', branch.family_space_id)
                .eq('user_id', user?.id)
                .maybeSingle();
            const role = normalizeFamilyRole(membership?.role);
            // Owners always can; Admins need archiveBranches policy
            if (role !== 'owner' && perms.archiveBranches === false) {
                return res.status(403).json({
                    error: 'Governance policy blocks archiving/deleting branches. Enable it in Owner Governance.'
                });
            }
        }

        const { error } = await supabase
            .from('family_branches')
            .delete()
            .eq('id', id);

        if (error) throw error;

        if (branch) {
            await logActivity(user.id, 'DELETE_BRANCH', 'family_branches', id, branch.family_space_id, {
                branch_name: branch.name,
                branch_code: branch.code,
                diff: {
                    status: { old: 'active', new: 'deleted' },
                    branch_name: { old: branch.name, new: 'deleted' }
                }
            });
        }

        res.json({ message: 'Branch deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get a single branch by ID.
 */
export const getBranchById = async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase
            .from('family_branches')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        // Multi-Source Name Resolution
        const rootId = data.root_person_id;
        const headId = data.head_person_id;
        const adminId = data.branch_admin_id;

        const nameMap = {};

        // 1. Resolve Person Names
        const personIds = [rootId, headId].filter(Boolean);
        if (personIds.length > 0) {
            const { data: pData } = await supabase.from('persons').select('id, full_name, first_name, last_name').in('id', personIds);
            (pData || []).forEach(p => {
                nameMap[p.id] = p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
            });
        }

        // 2. Resolve Admin Name (User Table)
        if (adminId) {
            console.log('>>> [DEBUG_BRANCH] Resolving Admin Name for ID:', adminId);
            const { data: uData, error: uError } = await supabase.from('users').select('id, first_name, last_name, email').eq('id', adminId).maybeSingle();
            if (uError) console.error('>>> [DEBUG_BRANCH] Admin Resolution Error:', uError);
            if (uData) {
                const adminName = `${uData.first_name || ''} ${uData.last_name || ''}`.trim() || uData.email;
                console.log('>>> [DEBUG_BRANCH] Admin Found:', adminName);
                nameMap[adminId] = adminName;
            } else {
                console.warn('>>> [DEBUG_BRANCH] Admin NOT found in users table for ID:', adminId);
            }
        }

        // 3. Analytics Engine (Snapshot Data)
        // Discovery Pass for this specific branch
        const { count: directMembers } = await supabase.from('persons').select('*', { count: 'exact', head: true }).eq('branch_id', id);

        // Find relatives (Halo) for people in this branch
        const { data: branchCore } = await supabase.from('persons').select('id').eq('branch_id', id);
        const coreIds = branchCore?.map(p => p.id) || [];
        let haloCount = 0;
        if (coreIds.length > 0) {
            const { data: rels } = await supabase.from('person_relationships').select('person_id, related_person_id').or(`person_id.in.(${coreIds.join(',')}),related_person_id.in.(${coreIds.join(',')})`);
            const relatives = new Set();
            (rels || []).forEach(r => {
                if (!coreIds.includes(r.person_id)) relatives.add(r.person_id);
                if (!coreIds.includes(r.related_person_id)) relatives.add(r.related_person_id);
            });
            haloCount = relatives.size;
        }

        // Migration Nodes (Distinct locations)
        const { data: locations } = await supabase.from('persons').select('place_of_birth, current_location').eq('branch_id', id);
        const uniqueLocs = new Set();
        (locations || []).forEach(l => {
            if (l.place_of_birth) uniqueLocs.add(l.place_of_birth);
            if (l.current_location) uniqueLocs.add(l.current_location);
        });

        // Media and Stories
        const { count: mediaCount } = await supabase.from('family_media').select('*', { count: 'exact', head: true }).eq('branch_id', id);
        const { count: storyCount } = await supabase.from('family_stories').select('*', { count: 'exact', head: true }).eq('branch_id', id);

        const enriched = {
            ...data,
            root_person: rootId ? { id: rootId, full_name: nameMap[rootId] || 'Unknown Ancestor' } : null,
            persons: headId ? { id: headId, full_name: nameMap[headId] || 'Unknown Head' } : null,
            branch_admin: adminId ? { id: adminId, full_name: nameMap[adminId] || 'Unknown Admin', is_virtual: true } : null,
            memberCount: (directMembers || 0) + haloCount,
            householdCount: Math.ceil(((directMembers || 0) + haloCount) / 3),
            generationCount: 1,
            migrationNodes: uniqueLocs.size,
            historyChapters: storyCount || 0,
            mediaAssets: mediaCount || 0
        };

        res.json(enriched);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Update an existing branch.
 */
export const updateBranch = async (req, res) => {
    try {
        const { id } = req.params;
        const updates = { ...req.body };
        const { user } = req;

        // Resolve Virtual Nodes (User IDs) to real Person IDs
        if (updates.root_person_id) updates.root_person_id = await resolvePersonId(updates.root_person_id, updates.family_space_id);
        if (updates.head_person_id) updates.head_person_id = await resolvePersonId(updates.head_person_id, updates.family_space_id);

        // Sanitize
        ['founding_year', 'root_person_id', 'head_person_id', 'branch_admin_id'].forEach(key => {
            if (updates[key] === '' || updates[key] === 'null' || updates[key] === '[object Object]') updates[key] = null;
        });

        if (req.file) {
            const { data: existing } = await supabase.from('family_branches').select('family_space_id').eq('id', id).single();
            if (existing) {
                const ext = req.file.originalname.split('.').pop().toLowerCase();
                const path = `${existing.family_space_id}/branch-emblem-${Date.now()}.${ext}`;
                updates.emblem_url = await uploadFile(BUCKETS.MEDIA, path, req.file.buffer, req.file.mimetype);
            }
        }

        const { data: existingBranch } = await supabase.from('family_branches').select('*').eq('id', id).single();

        if (updates.branch_admin_id !== undefined && updates.branch_admin_id) {
            await validateBranchAdminEmail(updates.branch_admin_id);
        }

        // If the user is a branch admin (and not family owner/admin), create an approval request instead of updating directly
        if (req.familyRole === 'branch-admin') {
            // We want to create a request
            const { data: reqData, error: reqError } = await supabase
                .from('branch_edit_requests')
                .insert({
                    family_space_id: updates.family_space_id || existingBranch?.family_space_id,
                    branch_id: id,
                    requested_by: user.id,
                    request_type: 'update_info',
                    current_value: existingBranch,
                    proposed_value: updates,
                    reason: req.body.reason || 'Branch details update',
                    status: 'pending'
                })
                .select()
                .single();

            if (reqError) throw reqError;
            return res.status(202).json({ message: 'Branch update request submitted for approval.', request: reqData });
        }

        // Otherwise, update directly (for owners/admins)
        let pendingBranchAdminId;
        if (updates.branch_admin_id !== undefined) {
            pendingBranchAdminId = updates.branch_admin_id;
            delete updates.branch_admin_id;
        }

        const { data, error } = await supabase
            .from('family_branches')
            .update(updates)
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Automatically link the selected Root Ancestor and Branch Head to this branch
        const personsToLink = [data.root_person_id, data.head_person_id].filter(Boolean);
        if (personsToLink.length > 0) {
            await supabase.from('persons').update({ branch_id: data.id }).in('id', personsToLink);
        }

        if (pendingBranchAdminId !== undefined) {
            const finalAdminId = await validateAndAssignBranchAdmin(id, data.family_space_id, pendingBranchAdminId, existingBranch?.branch_admin_id);
            if (finalAdminId !== data.branch_admin_id) {
                await supabase.from('family_branches').update({ branch_admin_id: finalAdminId }).eq('id', data.id);
                data.branch_admin_id = finalAdminId;
            }
        }

        await logActivity(user.id, 'UPDATE_BRANCH', 'family_branches', id, data.family_space_id, {
            branch_name: data.name,
            branch_code: data.code,
            branch_admin_id: data.branch_admin_id || 'unassigned',
            root_person_id: data.root_person_id || 'unassigned',
            head_person_id: data.head_person_id || 'unassigned',
            diff: {
                branch_name: { old: branch.name || 'previous', new: data.name },
                branch_code: { old: branch.code || 'previous', new: data.code }
            }
        });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
