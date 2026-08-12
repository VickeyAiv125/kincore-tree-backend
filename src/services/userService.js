import { supabase } from '../config/supabaseClient.js';

/** PRD §10.3.2 community standing titles */
const LEVEL_TITLES = {
    1: 'Initiate',
    2: 'Participant',
    3: 'Contributor',
    4: 'Historian',
    5: 'Connector',
    6: 'Steward',
    7: 'Custodian',
    8: 'Elder Contributor',
    9: 'Lineage Guardian',
    10: 'Legacy Pillar'
};

function yearFromDate(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})/);
    if (match) return Number(match[1]);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.getFullYear();
}

function formatLifeYears(birthYear, deathYear, isDeceased) {
    if (!birthYear) return null;
    if (isDeceased && deathYear) return `${birthYear}-${deathYear}`;
    return `${birthYear}-Present`;
}

async function safeCount(table, column, userId) {
    try {
        const { count, error } = await supabase
            .from(table)
            .select('id', { count: 'exact', head: true })
            .eq(column, userId);
        if (error) return 0;
        return count || 0;
    } catch (_) {
        return 0;
    }
}

function resolveStanding({ storedLevel, storedTitle, storedXp, spacesCount, claimedCount, contributionCount }) {
    const stored = Number(storedLevel);
    if (Number.isFinite(stored) && stored >= 1) {
        const level = Math.min(10, Math.max(1, Math.round(stored)));
        return {
            xp_points: Number(storedXp) || 0,
            level,
            level_title: storedTitle || LEVEL_TITLES[level],
            level_label: `Level ${level} ${storedTitle || LEVEL_TITLES[level]}`
        };
    }

    let level = 1;
    if (spacesCount > 0) level = 2;
    if (claimedCount > 0 || contributionCount >= 1) level = 3;
    if (claimedCount > 0 && contributionCount >= 3) level = 4;
    if (contributionCount >= 10) level = 5;
    if (contributionCount >= 20) level = 6;
    if (contributionCount >= 40) level = 7;
    if (contributionCount >= 70) level = 8;
    if (contributionCount >= 100) level = 9;
    if (contributionCount >= 150) level = 10;

    const xp = (spacesCount * 20) + (claimedCount * 50) + (contributionCount * 25);
    const title = LEVEL_TITLES[level];
    return {
        xp_points: xp,
        level,
        level_title: title,
        level_label: `Level ${level} ${title}`
    };
}

export const UserService = {
    async getMe(userId, { familySpaceId } = {}) {
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) throw error;

        const { data: memberships } = await supabase
            .from('family_memberships')
            .select('family_space_id, role, family:family_spaces(id, name)')
            .eq('user_id', userId);

        const spaces = (memberships || []).map((m) => ({
            id: m.family_space_id,
            name: m.family?.name || null,
            role: m.role || 'member'
        }));
        const spacesCount = spaces.length;

        const loadClaimedPersons = async (columns) => {
            let query = supabase.from('persons').select(columns).eq('claimed_by', userId);
            if (familySpaceId) query = query.eq('family_space_id', familySpaceId);
            return query;
        };

        let claimedPersons = [];
        {
            const full = await loadClaimedPersons(
                'id, full_name, first_name, last_name, date_of_birth, birth_date, death_date, is_alive, status, family_space_id'
            );
            if (full.error) {
                const basic = await loadClaimedPersons(
                    'id, full_name, first_name, last_name, birth_date, death_date, status, family_space_id'
                );
                claimedPersons = basic.data || [];
            } else {
                claimedPersons = full.data || [];
            }
        }
        const person = claimedPersons[0] || null;

        const birthDate = person?.date_of_birth || person?.birth_date || user.date_of_birth || null;
        const deathDate = person?.death_date || user.death_date || null;
        const isDeceased = person?.is_alive === false
            || person?.status === 'deceased'
            || !!deathDate;
        const birthYear = yearFromDate(birthDate);
        const deathYear = yearFromDate(deathDate);
        const lifeYears = formatLifeYears(birthYear, deathYear, isDeceased);

        const [postCount, mediaCount, eventCount] = await Promise.all([
            safeCount('posts', 'user_id', userId),
            safeCount('media', 'user_id', userId),
            safeCount('events', 'creator_id', userId)
        ]);
        const contributionCount = postCount + mediaCount + eventCount;
        const claimedCount = claimedPersons?.length || 0;

        const standing = resolveStanding({
            storedLevel: user.level ?? user.community_level,
            storedTitle: user.level_title,
            storedXp: user.xp_points ?? user.xp,
            spacesCount,
            claimedCount,
            contributionCount
        });

        const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim()
            || person?.full_name
            || null;

        return {
            ...user,
            full_name: fullName,
            family_id: user.family_id || spaces[0]?.id || null,
            family_name: user.family_name || spaces[0]?.name || null,
            spaces,
            spaces_count: spacesCount,
            person_id: person?.id || user.person_id || null,
            date_of_birth: birthDate,
            death_date: deathDate || null,
            birth_year: birthYear,
            death_year: deathYear,
            life_years: lifeYears,
            xp_points: standing.xp_points,
            level: standing.level,
            level_title: standing.level_title,
            level_label: standing.level_label
        };
    },

    async updateMe(userId, updates) {
        const allowedFields = [
            'first_name',
            'last_name',
            'avatar_url',
            'language',
            'theme',
            'date_of_birth',
            'bio',
            'place_of_birth',
            'gender',
            'hide_birth_date',
            'hide_location',
            'hide_living_status',
            'protect_as_minor',
            'occupation',
            'designation',
            'company_name',
            'website',
            'linkedin',
            'instagram',
            'facebook',
            'other_link'
        ];

        const updatePayload = {
            updated_at: new Date().toISOString()
        };

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                updatePayload[field] = updates[field];
            }
        }

        const { data, error } = await supabase
            .from('users')
            .update(updatePayload)
            .eq('id', userId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }
};
