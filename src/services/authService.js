import { supabase } from '../config/supabaseClient.js';

const normalizeRole = (roleStr) => {
    if (!roleStr) return null;
    const r = roleStr.toLowerCase().trim();
    if (r === 'branch admin' || r === 'branch-admin' || r === 'manager') return 'branch-admin';
    if (r === 'family admin' || r === 'family-admin' || r === 'admin') return 'family-admin';
    if (r === 'co-admin' || r === 'coadmin' || r === 'co admin') return 'co-admin';
    if (r === 'council admin' || r === 'council-admin' || r === 'council' || r === 'editor') return 'council';
    if (r === 'owner') return 'owner';
    if (r === 'business' || r === 'business-admin') return 'business';
    if (r === 'devops') return 'devops';
    if (r === 'auditor') return 'auditor';
    return r;
};

// Pre-defined Admin Roles
const DEFAULT_ADMINS = {
    'family@admin.com': 'superadmin',
    'owner@admin.com': 'owner',
    'council@admin.com': 'council',
    'branch@admin.com': 'branch-admin',
    'business@admin.com': 'business',
    'devops@admin.com': 'devops',
    'auditor@admin.com': 'auditor'
};

const PERSON_CREATING_ROLES = new Set(['owner', 'admin', 'family-admin', 'co-admin']);

/**
 * Resolve the authenticated user's Person node in the selected family.
 * For legacy owner/admin spaces that are completely empty, create the initial
 * root node so relationship APIs have a valid target_person_id.
 */
const resolvePrimaryPerson = async ({ userId, email, matchingIds, primarySpace, profile }) => {
    if (!primarySpace?.id) return null;

    const { data: claimedPerson, error: claimedError } = await supabase
        .from('persons')
        .select('id')
        .eq('family_space_id', primarySpace.id)
        .in('claimed_by', matchingIds)
        .limit(1)
        .maybeSingle();

    if (claimedError) throw claimedError;
    if (claimedPerson) return claimedPerson.id;

    const { data: emailPerson, error: emailError } = await supabase
        .from('persons')
        .select('id')
        .eq('family_space_id', primarySpace.id)
        .ilike('email', email)
        .limit(1)
        .maybeSingle();

    if (emailError) throw emailError;
    if (emailPerson) {
        await supabase
            .from('persons')
            .update({ claimed_by: userId })
            .eq('id', emailPerson.id)
            .is('claimed_by', null);
        return emailPerson.id;
    }

    if (!PERSON_CREATING_ROLES.has(normalizeRole(primarySpace.role))) return null;

    const { count, error: countError } = await supabase
        .from('persons')
        .select('id', { count: 'exact', head: true })
        .eq('family_space_id', primarySpace.id);

    if (countError) throw countError;
    // Do not create a disconnected admin node in an existing populated tree.
    if (count !== 0) return null;

    const metadata = profile?.user_metadata || {};
    const firstName = profile?.first_name || metadata.first_name || metadata.given_name || 'Family';
    const lastName = profile?.last_name || metadata.last_name || metadata.family_name || 'Admin';
    const { data: rootPerson, error: rootError } = await supabase
        .from('persons')
        .insert({
            family_space_id: primarySpace.id,
            first_name: firstName,
            last_name: lastName,
            full_name: `${firstName} ${lastName}`.trim(),
            email,
            claimed_by: userId,
            role: 'Root Ancestor',
            gender: 'other',
            status: 'active',
            privacy_mode: 'public'
        })
        .select('id')
        .single();

    if (rootError) throw rootError;
    return rootPerson.id;
};

export const AuthService = {
    async signup({ email, password, first_name, last_name, date_of_birth }) {
        if (!email || !password) {
            throw new Error('Email and password are required');
        }

        const cleanEmail = email.trim().toLowerCase().replace(/[“”"']/g, '');

        const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
                data: {
                    first_name: first_name || '',
                    last_name: last_name || '',
                    date_of_birth: date_of_birth || null
                }
            }
        });

        if (error) throw error;

        const userId = data.user.id;

        // Sync to local users table
        await supabase.from('users').insert({
            id: userId,
            email: cleanEmail,
            first_name: first_name || '',
            last_name: last_name || '',
            date_of_birth: date_of_birth || null,
            status: 'active'
        });

        const assignedRole = DEFAULT_ADMINS[cleanEmail];
        if (assignedRole) {
            await supabase.from('admin_users').insert({
                user_id: userId,
                role: assignedRole
            });
        }

        return { user: data.user, assignedRole };
    },

    async login({ email, password }) {
        const cleanEmail = email.trim().toLowerCase().replace(/[“”"']/g, '');
        const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });

        if (error) throw error;

        const userId = data.user.id;

        // Check if user is suspended
        const { data: userRecord } = await supabase
            .from('users')
            .select('status')
            .eq('id', userId)
            .single();
            
        if (userRecord?.status === 'suspended') {
            await supabase.auth.signOut();
            throw new Error('Your account has been suspended. Please contact support.');
        }

        // Auto-link any pending invitations or role assignments when logging in
        await this.completeInvite({ id: userId, email: cleanEmail }).catch(e => console.warn('Auto completeInvite note:', e.message));

        // 1. Check Global Admin Role
        let { data: adminRecord } = await supabase
            .from('admin_users')
            .select('role')
            .eq('user_id', userId)
            .maybeSingle();

        // 🚨 OVERRIDE: Force role for predefined system admins to fix redirection mismatches
        if (DEFAULT_ADMINS[cleanEmail]) {
            console.log(`>>> [AUTH_LOGIN] System Admin Override: ${cleanEmail} -> ${DEFAULT_ADMINS[cleanEmail]}`);
            adminRecord = { role: DEFAULT_ADMINS[cleanEmail] };
        }

        // 2. Discover all spaces where the user has a role across any matching email account
        const { data: emailUsers } = await supabase.from('users').select('id').ilike('email', cleanEmail);
        const matchingIds = [...new Set([userId, ...(emailUsers || []).map(u => u.id)])];

        const [staffRes, memRes, personBranchRes, branchAdminRes] = await Promise.all([
            supabase
                .from('family_space_staff')
                .select('family_space_id, role, family:family_spaces(name, visibility)')
                .in('user_id', matchingIds)
                .eq('is_active', true),
            supabase
                .from('family_memberships')
                .select('family_space_id, role, branch_id, family:family_spaces(name, visibility)')
                .in('user_id', matchingIds),
            supabase
                .from('persons')
                .select('family_space_id, branch_id')
                .or(`claimed_by.in.(${matchingIds.join(',')}),email.ilike.${cleanEmail}`),
            supabase
                .from('family_branches')
                .select('id, family_space_id')
                .in('branch_admin_id', matchingIds)
        ]);

        // Merge and deduplicate (Staff roles take priority)
        const spacesMap = new Map();
        
        // Add membership roles first
        (memRes.data || []).forEach(m => {
            spacesMap.set(m.family_space_id, {
                id: m.family_space_id,
                name: m.family?.name || 'Unknown Family',
                role: normalizeRole(m.role) || 'member',
                branch_id: m.branch_id || null
            });
        });

        // Overwrite with Staff roles (Higher priority)
        (staffRes.data || []).forEach(s => {
            const existing = spacesMap.get(s.family_space_id) || {};
            spacesMap.set(s.family_space_id, {
                id: s.family_space_id,
                name: s.family?.name || 'Unknown Family',
                role: normalizeRole(s.role) || 'staff',
                branch_id: existing.branch_id || null
            });
        });

        const allSpaces = Array.from(spacesMap.values());
        
        let primarySpace = null;
        if (allSpaces.length > 0) {
            const roleWeights = { 
                'owner': 5, 
                'admin': 4, 
                'family-admin': 4,
                'co-admin': 3.8,
                'branch-admin': 3.5,
                'council': 3.5,
                'manager': 3, 
                'editor': 2, 
                'staff': 1.5, 
                'member': 1 
            };
            
            primarySpace = allSpaces.sort((a, b) => {
                const weightA = roleWeights[a.role] || 0;
                const weightB = roleWeights[b.role] || 0;
                return weightB - weightA;
            })[0];
        }

        // 3. Update Telemetry
        await supabase
            .from('users')
            .update({ last_login_at: new Date().toISOString() })
            .eq('id', userId);

        // 🚨 Fallback only for global platform/super admins without explicit memberships
        if (!primarySpace && adminRecord && ['platform-admin', 'super_admin', 'business-admin'].includes(adminRecord.role)) {
            const { data: firstSpace } = await supabase.from('family_spaces').select('id, name').limit(1).maybeSingle();
            if (firstSpace) {
                primarySpace = { id: firstSpace.id, name: firstSpace.name, role: normalizeRole(adminRecord.role) };
            }
        }

        const resolvedRole = DEFAULT_ADMINS[cleanEmail] 
            || (adminRecord && ['platform-admin', 'superadmin', 'super_admin'].includes(adminRecord.role) ? adminRecord.role : null)
            || normalizeRole(primarySpace?.role) 
            || normalizeRole(adminRecord?.role) 
            || 'member';

        const resolvedBranchId = primarySpace?.branch_id
            || branchAdminRes?.data?.[0]?.id
            || personBranchRes?.data?.find(p => p.branch_id)?.branch_id
            || null;

        const personId = await resolvePrimaryPerson({
            userId,
            email: cleanEmail,
            matchingIds,
            primarySpace,
            profile: data.user
        });

        return {
            token: data.session.access_token,
            user: {
                ...data.user,
                role: resolvedRole,
                family_id: primarySpace?.id || null,
                family_name: primarySpace?.name || null,
                person_id: personId,
                target_person_id: personId,
                spaces: allSpaces,
                branch_id: cleanEmail === 'branch@admin.com' 
                    ? '6b8eb992-571f-4637-b031-a56007560cad' 
                    : resolvedBranchId
            }
        };
    },

    async oauthLogin({ email, access_token, id_token, provider, client_type, allow_signup }) {
        let userId = null;
        let cleanEmail = null;
        let userObj = null;
        let sessionAccessToken = access_token || null;

        // Native mobile Google: exchange Google ID token → Supabase session
        if (!sessionAccessToken && id_token && String(provider || '').toLowerCase() === 'google') {
            const tokenInfoRes = await fetch(
                `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(id_token)}`
            );
            const tokenInfo = await tokenInfoRes.json();
            if (!tokenInfoRes.ok) {
                throw new Error(tokenInfo.error_description || tokenInfo.error || 'Invalid Google ID token');
            }

            const expectedClientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
            if (expectedClientId && tokenInfo.aud && tokenInfo.aud !== expectedClientId) {
                // Accept Android/iOS client IDs when listed in GOOGLE_OAUTH_CLIENT_IDS
                const allowed = new Set([
                    expectedClientId,
                    ...String(process.env.GOOGLE_OAUTH_CLIENT_IDS || '')
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                ]);
                if (!allowed.has(tokenInfo.aud)) {
                    throw new Error('Google ID token audience is not allowed for this app');
                }
            }

            if (!tokenInfo.email) {
                throw new Error('Google account did not return an email address');
            }
            if (tokenInfo.email_verified === 'false' || tokenInfo.email_verified === false) {
                throw new Error('Google email is not verified. Use a verified Google account.');
            }

            const { ensureUserFromGoogleProfile, createSessionForEmail } = await import('./googleAuthService.js');
            const profile = {
                sub: tokenInfo.sub,
                email: String(tokenInfo.email).trim().toLowerCase(),
                emailVerified: true,
                firstName: tokenInfo.given_name || '',
                lastName: tokenInfo.family_name || '',
                fullName: tokenInfo.name || '',
                avatarUrl: tokenInfo.picture || null,
                provider: 'google',
            };
            await ensureUserFromGoogleProfile(profile);
            const session = await createSessionForEmail(profile.email);
            sessionAccessToken = session.access_token;
        }

        if (sessionAccessToken) {
            const { data: { user: authUser }, error } = await supabase.auth.getUser(sessionAccessToken);
            if (error || !authUser) throw new Error('Invalid or expired OAuth access token.');
            userId = authUser.id;
            cleanEmail = authUser.email.trim().toLowerCase();
            userObj = authUser;
        } else if (email) {
            cleanEmail = email.trim().toLowerCase();
            // Look up by email in users table
            const { data: uRecord } = await supabase.from('users').select('*').ilike('email', cleanEmail).maybeSingle();
            if (!uRecord) {
                // Check if in admin_users or persons
                const { data: aRecord } = await supabase.from('admin_users').select('user_id').ilike('email', cleanEmail).maybeSingle();
                if (aRecord) userId = aRecord.user_id;
            } else {
                userId = uRecord.id;
                userObj = uRecord;
            }
            if (!userId) throw new Error('No OAuth account found with this email. Please complete signup first.');
        } else {
            throw new Error('Email, OAuth access_token, or Google id_token is required.');
        }

        // Check if user already exists in local users table
        let { data: userRecord } = await supabase.from('users').select('*').eq('id', userId).maybeSingle();

        // If user is not found locally, enforce Web Admin vs Mobile/Google signup rules:
        if (!userRecord) {
            const isSocialSignup =
                allow_signup === true
                || provider === 'google'
                || provider === 'facebook'
                || provider === 'kcc'
                || client_type === 'app';

            if (client_type === 'web' && !isSocialSignup) {
                // Web Admin Panel (password/OAuth without Google): Login ONLY unless invited
                const { data: adminCheck } = await supabase.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle();
                const { data: personCheck } = await supabase.from('persons').select('id').ilike('email', cleanEmail).maybeSingle();
                if (!adminCheck && !personCheck && !DEFAULT_ADMINS[cleanEmail]) {
                    throw new Error('Account not found. Use Google Sign-In to create an account, or sign up via the Kincore mobile app.');
                }
            }

            // Mobile App / Google SSO / invited web admin: Auto-create user profile
            if (userObj || userId) {
                const { data: newUser } = await supabase.from('users').insert({
                    id: userId,
                    email: cleanEmail,
                    first_name: userObj?.user_metadata?.first_name || userObj?.user_metadata?.given_name || null,
                    last_name: userObj?.user_metadata?.last_name || userObj?.user_metadata?.family_name || null,
                    avatar_url: userObj?.user_metadata?.avatar_url || userObj?.user_metadata?.picture || null,
                    status: 'active',
                    created_at: new Date().toISOString()
                }).select().single();
                userRecord = newUser || { id: userId, email: cleanEmail };
            }
        }

        if (userRecord?.status === 'suspended') {
            throw new Error('Your account has been suspended. Please contact support.');
        }

        // Auto-link any pending invitations or role assignments when logging in
        await this.completeInvite({ id: userId, email: cleanEmail }).catch(e => console.warn('Auto completeInvite note:', e.message));

        // 1. Check Global Admin Role
        let { data: adminRecord } = await supabase.from('admin_users').select('role').eq('user_id', userId).maybeSingle();
        if (DEFAULT_ADMINS[cleanEmail]) {
            console.log(`>>> [AUTH_OAUTH] System Admin Override: ${cleanEmail} -> ${DEFAULT_ADMINS[cleanEmail]}`);
            adminRecord = { role: DEFAULT_ADMINS[cleanEmail] };
        }

        // 2. Discover all spaces where the user has a role across any matching email account
        const { data: emailUsers } = await supabase.from('users').select('id').ilike('email', cleanEmail);
        const matchingIds = [...new Set([userId, ...(emailUsers || []).map(u => u.id)])];

        const [staffRes, memRes, personBranchRes, branchAdminRes] = await Promise.all([
            supabase.from('family_space_staff').select('family_space_id, role, family:family_spaces(name, visibility)').in('user_id', matchingIds).eq('is_active', true),
            supabase.from('family_memberships').select('family_space_id, role, branch_id, family:family_spaces(name, visibility)').in('user_id', matchingIds),
            supabase.from('persons').select('family_space_id, branch_id').or(`claimed_by.in.(${matchingIds.join(',')}),email.ilike.${cleanEmail}`),
            supabase.from('family_branches').select('id, family_space_id').in('branch_admin_id', matchingIds)
        ]);

        const spacesMap = new Map();
        (memRes.data || []).forEach(m => {
            spacesMap.set(m.family_space_id, { id: m.family_space_id, name: m.family?.name || 'Unknown Family', role: normalizeRole(m.role) || 'member', branch_id: m.branch_id || null });
        });
        (staffRes.data || []).forEach(s => {
            const existing = spacesMap.get(s.family_space_id) || {};
            spacesMap.set(s.family_space_id, { id: s.family_space_id, name: s.family?.name || 'Unknown Family', role: normalizeRole(s.role) || 'staff', branch_id: existing.branch_id || null });
        });

        const allSpaces = Array.from(spacesMap.values());
        let primarySpace = null;
        if (allSpaces.length > 0) {
            const roleWeights = { 'owner': 5, 'admin': 4, 'family-admin': 4, 'branch-admin': 3.5, 'council': 3.5, 'manager': 3, 'editor': 2, 'staff': 1.5, 'member': 1 };
            primarySpace = allSpaces.sort((a, b) => (roleWeights[b.role] || 0) - (roleWeights[a.role] || 0))[0];
        }

        await supabase.from('users').update({ last_login_at: new Date().toISOString() }).eq('id', userId);

        if (!primarySpace && adminRecord && ['platform-admin', 'super_admin', 'business-admin'].includes(adminRecord.role)) {
            const { data: firstSpace } = await supabase.from('family_spaces').select('id, name').limit(1).maybeSingle();
            if (firstSpace) primarySpace = { id: firstSpace.id, name: firstSpace.name, role: normalizeRole(adminRecord.role) };
        }

        const resolvedRole = DEFAULT_ADMINS[cleanEmail] 
            || (adminRecord && ['platform-admin', 'superadmin', 'super_admin'].includes(adminRecord.role) ? adminRecord.role : null)
            || normalizeRole(primarySpace?.role) 
            || normalizeRole(adminRecord?.role) 
            || 'member';

        const resolvedBranchId = primarySpace?.branch_id
            || branchAdminRes?.data?.[0]?.id
            || personBranchRes?.data?.find(p => p.branch_id)?.branch_id
            || null;

        const personId = await resolvePrimaryPerson({
            userId,
            email: cleanEmail,
            matchingIds,
            primarySpace,
            profile: userRecord || userObj
        });

        return {
            token: sessionAccessToken || access_token || 'oauth-session',
            user: {
                ...(userRecord || userObj || { id: userId, email: cleanEmail }),
                role: resolvedRole,
                family_id: primarySpace?.id || null,
                family_name: primarySpace?.name || null,
                person_id: personId,
                target_person_id: personId,
                spaces: allSpaces,
                branch_id: cleanEmail === 'branch@admin.com' ? '6b8eb992-571f-4637-b031-a56007560cad' : resolvedBranchId
            }
        };
    },

    async requestOtp({ email }) {
        const cleanEmail = email.trim().toLowerCase();
        const { error } = await supabase.auth.signInWithOtp({ email: cleanEmail });
        if (error) throw error;
        return true;
    },

    async verifyOtp({ email, token, type }) {
        const { data, error } = await supabase.auth.verifyOtp({ email, token, type: type || 'signup' });
        if (error) throw error;
        return data.session;
    },

    async changePassword({ new_password }) {
        const { error } = await supabase.auth.updateUser({ password: new_password });
        if (error) throw error;
        return true;
    },

    async webForgotPassword({ email }) {
        if (!email) throw new Error('Email is required');
        const cleanEmail = email.trim().toLowerCase();

        // Option B: Immediate UI feedback if account doesn't exist
        let found = false;
        const { data: user } = await supabase.from('users').select('id').ilike('email', cleanEmail).maybeSingle();
        if (user) found = true;

        if (!found) {
            const { data: adminUser } = await supabase.from('admin_users').select('id').ilike('email', cleanEmail).maybeSingle();
            if (adminUser) found = true;
        }

        if (!found) {
            const { data: personUser } = await supabase.from('persons').select('id').ilike('email', cleanEmail).maybeSingle();
            if (personUser) found = true;
        }

        if (!found) {
            const error = new Error('No account found with this email address. Please check your spelling or sign up.');
            error.status = 404;
            throw error;
        }

        const redirectTo = `${process.env.FRONTEND_URL || 'https://kincore-tree.vercel.app'}/reset-password`;
        const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
            redirectTo
        });
        if (error) throw error;
        return true;
    },

    async appForgotPassword({ email }) {
        if (!email) throw new Error('Email is required');
        const cleanEmail = email.trim().toLowerCase();

        // Option B: Immediate UI feedback if account doesn't exist
        let found = false;
        const { data: user } = await supabase.from('users').select('id').ilike('email', cleanEmail).maybeSingle();
        if (user) found = true;

        if (!found) {
            const { data: adminUser } = await supabase.from('admin_users').select('id').ilike('email', cleanEmail).maybeSingle();
            if (adminUser) found = true;
        }

        if (!found) {
            const { data: personUser } = await supabase.from('persons').select('id').ilike('email', cleanEmail).maybeSingle();
            if (personUser) found = true;
        }

        if (!found) {
            const error = new Error('No account found with this email address. Please check your spelling or sign up.');
            error.status = 404;
            throw error;
        }

        // Send 6-digit OTP via Supabase Auth signInWithOtp without creating a user
        const { error } = await supabase.auth.signInWithOtp({ 
            email: cleanEmail,
            options: {
                shouldCreateUser: false
            }
        });
        if (error) throw error;
        return true;
    },

    async appResetPassword({ email, otp_code, new_password }) {
        if (!email || !otp_code || !new_password) {
            throw new Error('Email, OTP code, and new password are required');
        }
        const cleanEmail = email.trim().toLowerCase();

        // Verify the OTP code
        let verifiedSession = null;
        const { data, error: verifyErr } = await supabase.auth.verifyOtp({
            email: cleanEmail,
            token: otp_code.trim(),
            type: 'magiclink'
        });

        if (verifyErr) {
            const { data: dataRec, error: recErr } = await supabase.auth.verifyOtp({
                email: cleanEmail,
                token: otp_code.trim(),
                type: 'recovery'
            });
            if (recErr) {
                const { data: dataEmail, error: emailErr } = await supabase.auth.verifyOtp({
                    email: cleanEmail,
                    token: otp_code.trim(),
                    type: 'email'
                });
                if (emailErr) {
                    const error = new Error('Invalid or expired OTP code.');
                    error.status = 400;
                    throw error;
                }
                verifiedSession = dataEmail.session;
            } else {
                verifiedSession = dataRec.session;
            }
        } else {
            verifiedSession = data.session;
        }

        // Once OTP is verified and session is set, update password
        const { error: updateErr } = await supabase.auth.updateUser({
            password: new_password
        });
        if (updateErr) throw updateErr;

        return true;
    },

    async refreshToken({ refresh_token }) {
        const { data, error } = await supabase.auth.refreshSession({ refresh_token });
        if (error) throw error;
        return data.session;
    },

    async logout() {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        return true;
    },

    async completeInvite(user) {
        if (!user || !user.email) throw new Error("Unauthorized");

        const cleanEmail = user.email.trim().toLowerCase();

        // 0. Ensure user exists in public users table first to prevent foreign key errors
        await supabase.from('users').upsert({
            id: user.id,
            email: cleanEmail,
            status: 'active'
        }, { onConflict: 'id' });

        // 1. Find the pending person record(s)
        const { data: persons, error: pErr } = await supabase
            .from('persons')
            .select('*')
            .ilike('email', cleanEmail)
            .eq('member_status', 'invitation_pending');

        if (pErr) throw pErr;
        if (!persons || persons.length === 0) {
            return true; // Already processed or no invitation
        }

        for (const person of persons) {
            const rawRole = person.pending_role || person.role || 'member';
            const finalRole = normalizeRole(rawRole) || 'member';

            // 2. Link person record to the authenticated user and activate
            await supabase.from('persons').update({
                claimed_by: user.id,
                member_status: 'active_user',
                role: finalRole,
                pending_role: null
            }).eq('id', person.id);

            // Also sync the name back to the user account
            await supabase.from('users').update({
                first_name: person.first_name || person.full_name?.split(' ')[0] || null,
                last_name: person.last_name || person.full_name?.split(' ').slice(1).join(' ') || null
            }).eq('id', user.id);

            // 3. Grant access to the Family Space
            if (person.family_space_id) {
                const { error: mErr } = await supabase.from('family_memberships').upsert({
                    user_id: user.id,
                    family_space_id: person.family_space_id,
                    role: finalRole,
                    branch_id: person.branch_id || null,
                    status: 'active'
                }, { onConflict: 'user_id, family_space_id' });
                
                if (mErr) console.error("Error adding membership:", mErr);

                const staffRoles = ['owner', 'family-admin', 'branch-admin', 'council', 'council-admin', 'editor'];
                if (staffRoles.includes(finalRole)) {
                    const staffRoleDB = finalRole === 'branch-admin' ? 'manager' :
                                        finalRole === 'family-admin' ? 'admin' :
                                        ['council', 'council-admin', 'editor'].includes(finalRole) ? 'editor' : 'owner';
                    await supabase.from('family_space_staff').upsert({
                        family_space_id: person.family_space_id,
                        user_id: user.id,
                        role: staffRoleDB,
                        is_active: true
                    }, { onConflict: 'family_space_id,user_id' });

                    await supabase.from('admin_users').upsert({
                        user_id: user.id,
                        role: finalRole
                    }, { onConflict: 'user_id' });
                }

                if (finalRole === 'branch-admin' && person.branch_id) {
                    await supabase.from('family_branches').update({
                        branch_admin_id: user.id
                    }).eq('id', person.branch_id);
                }
            }
        }
        return true;
    }
};
