/**
 * Family-scoped KCC ledger helpers (local kcc_ledger mirror).
 * Prefers family_space_id when present; falls back to member user_ids for legacy rows.
 */

let familySpaceColumnKnown = null; // null unknown | true | false

export const signedKccAmount = (row = {}) => {
    const amount = Number(row.amount || 0);
    if (!Number.isFinite(amount)) return 0;

    const type = String(row.type || row.transaction_type || '').toLowerCase();
    const direction = String(row.direction || '').toLowerCase();

    // Already signed values win
    if (amount < 0) return amount;

    if (
        direction === 'debit'
        || direction === 'out'
        || ['spend', 'debit', 'transfer_out', 'withdraw', 'burn'].includes(type)
    ) {
        return -Math.abs(amount);
    }

    if (
        direction === 'credit'
        || direction === 'in'
        || ['earn', 'credit', 'refund', 'deposit', 'mint', 'reward'].includes(type)
    ) {
        return Math.abs(amount);
    }

    // Default: trust stored sign (positive credit)
    return amount;
};

export const summarizeKccRows = (rows = []) => {
    let netBalance = 0;
    let totalCredits = 0;
    let totalDebits = 0;

    for (const row of rows) {
        const signed = signedKccAmount(row);
        netBalance += signed;
        if (signed >= 0) totalCredits += signed;
        else totalDebits += Math.abs(signed);
    }

    return {
        net_balance: Number(netBalance.toFixed(8)),
        total_credits: Number(totalCredits.toFixed(8)),
        total_debits: Number(totalDebits.toFixed(8)),
        volume: Number((totalCredits + totalDebits).toFixed(8)),
        transaction_count: rows.length
    };
};

const detectFamilySpaceColumn = async (supabase) => {
    if (familySpaceColumnKnown !== null) return familySpaceColumnKnown;
    const { error } = await supabase.from('kcc_ledger').select('family_space_id').limit(1);
    familySpaceColumnKnown = !error;
    return familySpaceColumnKnown;
};

/**
 * Load family KCC ledger rows.
 * @returns {{ rows, attribution, hasFamilySpaceColumn }}
 */
export const loadFamilyKccLedger = async (supabase, { familySpaceId, userIds = [], limit = 200 }) => {
    const hasCol = await detectFamilySpaceColumn(supabase);
    const select = '*, user:users(first_name, last_name, email)';
    const ids = (userIds || []).filter(Boolean);

    if (hasCol && familySpaceId) {
        const { data: bySpace, error: spaceErr } = await supabase
            .from('kcc_ledger')
            .select(select)
            .eq('family_space_id', familySpaceId)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (spaceErr) throw spaceErr;

        let legacy = [];
        if (ids.length) {
            const { data: legacyRows, error: legacyErr } = await supabase
                .from('kcc_ledger')
                .select(select)
                .in('user_id', ids)
                .is('family_space_id', null)
                .order('created_at', { ascending: false })
                .limit(limit);

            if (!legacyErr) legacy = legacyRows || [];
        }

        const map = new Map();
        [...(bySpace || []), ...legacy].forEach((row) => {
            if (row?.id) map.set(row.id, row);
        });
        const rows = Array.from(map.values()).sort(
            (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
        );

        return {
            rows: rows.slice(0, limit),
            attribution: 'family_space_id+legacy_null',
            hasFamilySpaceColumn: true
        };
    }

    // Legacy schema: member membership scope only
    if (!ids.length) {
        return { rows: [], attribution: 'empty', hasFamilySpaceColumn: false };
    }

    const { data, error } = await supabase
        .from('kcc_ledger')
        .select(select)
        .in('user_id', ids)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) throw error;

    return {
        rows: data || [],
        attribution: 'member_user_ids',
        hasFamilySpaceColumn: false
    };
};
