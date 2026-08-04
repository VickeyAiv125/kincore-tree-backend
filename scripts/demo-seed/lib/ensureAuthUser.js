import { sb, log, warn } from './supabase.js';

async function findAuthUserByEmail(email) {
    const clean = email.trim().toLowerCase();
    try {
        if (typeof sb.auth.admin.getUserByEmail === 'function') {
            const { data, error } = await sb.auth.admin.getUserByEmail(clean);
            if (!error && data?.user) return data.user;
        }
    } catch {
        // fall through
    }

    // Paginate listUsers (max ~200 per page)
    for (let page = 1; page <= 10; page += 1) {
        const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
        if (error) throw error;
        const match = (data?.users || []).find((u) => String(u.email || '').toLowerCase() === clean);
        if (match) return match;
        if (!(data?.users || []).length || (data.users.length < 200)) break;
    }
    return null;
}

/**
 * Ensure auth.users + public.users exist. Upserts password + profile.
 * Returns { id, email }.
 */
export async function ensureAuthUser({ email, password, first_name, last_name }) {
    const clean = email.trim().toLowerCase();
    let user = await findAuthUserByEmail(clean);

    if (!user) {
        const { data, error } = await sb.auth.admin.createUser({
            email: clean,
            password,
            email_confirm: true,
            user_metadata: { first_name, last_name, demo: true }
        });
        if (error) {
            // Race / already exists
            user = await findAuthUserByEmail(clean);
            if (!user) throw error;
        } else {
            user = data.user;
            log(`created auth user ${clean}`);
        }
    } else {
        const { error } = await sb.auth.admin.updateUserById(user.id, {
            password,
            email_confirm: true,
            user_metadata: {
                ...(user.user_metadata || {}),
                first_name,
                last_name,
                demo: true
            }
        });
        if (error) warn(`update password ${clean}:`, error.message);
        else log(`updated auth user ${clean}`);
    }

    const { error: userErr } = await sb.from('users').upsert({
        id: user.id,
        email: clean,
        first_name: first_name || null,
        last_name: last_name || null,
        status: 'active',
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    if (userErr) throw userErr;
    return { id: user.id, email: clean };
}

export async function ensureAdminRole(userId, role) {
    if (!role) return;
    const { error } = await sb.from('admin_users').upsert({
        user_id: userId,
        role
    }, { onConflict: 'user_id' });
    if (error) warn(`admin_users ${role}:`, error.message);
}
