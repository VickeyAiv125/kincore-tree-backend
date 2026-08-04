/**
 * Business Admin billing helpers — revenue, invoices, plans, commissions, refunds.
 */
import { supabase } from '../config/supabaseClient.js';
import { tableExists, readJsonDb, writeJsonDb } from '../utils/dbHelper.js';

export const DEFAULT_PLAN_PRICES = {
    free: 0,
    standard: 19.99,
    premium: 49.99,
    enterprise: 99.99
};

export const DEFAULT_PLANS = [
    {
        id: 'default-standard',
        name: 'Standard',
        price: 19.99,
        currency: 'USD',
        interval: 'month',
        is_active: true,
        features: ['Basic Features', '10GB Storage'],
        storage_gb: 10,
        max_members: 100,
        branch_limit: 5,
        feature_flags: { storage: true, exports: false, trees: true },
        trial_days: 0,
        terms: ''
    },
    {
        id: 'default-premium',
        name: 'Premium',
        price: 49.99,
        currency: 'USD',
        interval: 'month',
        is_active: true,
        features: ['Advanced Features', '50GB Storage', 'Priority Support'],
        storage_gb: 50,
        max_members: 500,
        branch_limit: 20,
        feature_flags: { storage: true, exports: true, trees: true, collaborators: true },
        trial_days: 14,
        terms: ''
    }
];

export const DEFAULT_COMMISSION = {
    marketplace_rate_percent: 10,
    ad_revenue_manual: 0,
    currency: 'USD'
};

const SETTINGS_PLANS_KEY = 'subscription_plans';
const SETTINGS_BILLING_KEY = 'billing_config';

const daysAgoIso = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

const growthPct = (current, previous) => {
    if (!previous && !current) return '0%';
    if (!previous) return current > 0 ? '+100%' : '0%';
    const pct = ((current - previous) / previous) * 100;
    const rounded = Math.round(pct);
    return `${rounded >= 0 ? '+' : ''}${rounded}%`;
};

export const readBillingConfig = async () => {
    try {
        const { data } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', SETTINGS_BILLING_KEY)
            .maybeSingle();
        return { ...DEFAULT_COMMISSION, ...(data?.value || {}) };
    } catch (_) {
        const fb = readJsonDb();
        return { ...DEFAULT_COMMISSION, ...(fb.billing_config || {}) };
    }
};

export const writeBillingConfig = async (value, actorId) => {
    const current = await readBillingConfig();
    const next = {
        ...current,
        ...Object.fromEntries(
            Object.entries(value || {}).filter(([, v]) => v !== undefined)
        ),
        updated_at: new Date().toISOString()
    };
    const { error } = await supabase
        .from('platform_settings')
        .upsert({ key: SETTINGS_BILLING_KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: 'key' });

    if (error) {
        const fb = readJsonDb();
        fb.billing_config = next;
        writeJsonDb(fb);
    }

    if (actorId) {
        await supabase.from('audit_logs').insert({
            actor_id: actorId,
            action: 'BILLING_CONFIG_UPDATE',
            target_type: 'platform_settings',
            target_id: SETTINGS_BILLING_KEY,
            details: next
        });
    }
    return next;
};

const readPlansFromSettings = async () => {
    try {
        const { data } = await supabase
            .from('platform_settings')
            .select('value')
            .eq('key', SETTINGS_PLANS_KEY)
            .maybeSingle();
        if (Array.isArray(data?.value) && data.value.length) return data.value;
    } catch (_) { /* fall through */ }
    const fb = readJsonDb();
    if (Array.isArray(fb.subscription_plans) && fb.subscription_plans.length) return fb.subscription_plans;
    return [];
};

const writePlansToSettings = async (plans) => {
    const { error } = await supabase
        .from('platform_settings')
        .upsert(
            { key: SETTINGS_PLANS_KEY, value: plans, updated_at: new Date().toISOString() },
            { onConflict: 'key' }
        );
    if (error) {
        const fb = readJsonDb();
        fb.subscription_plans = plans;
        writeJsonDb(fb);
    }
    return plans;
};

export const listSubscriptionPlans = async () => {
    const exists = await tableExists('subscription_plans');
    if (exists) {
        const { data, error } = await supabase
            .from('subscription_plans')
            .select('*')
            .order('price', { ascending: true });
        if (!error && data?.length) return data;
        if (!error && (!data || !data.length)) {
            // seed defaults into table if empty
            try {
                await supabase.from('subscription_plans').upsert(
                    DEFAULT_PLANS.map(({ id, ...rest }) => rest),
                    { onConflict: 'name' }
                );
                const retry = await supabase.from('subscription_plans').select('*').order('price', { ascending: true });
                if (retry.data?.length) return retry.data;
            } catch (_) { /* ignore */ }
        }
    }

    const fromSettings = await readPlansFromSettings();
    if (fromSettings.length) return fromSettings;
    await writePlansToSettings(DEFAULT_PLANS);
    return DEFAULT_PLANS;
};

export const saveSubscriptionPlan = async (payload, actorId) => {
    const interval = payload.interval
        || (payload.billingCycle === 'annual' || payload.cycle === 'annual' ? 'year' : 'month');

    const features = Array.isArray(payload.features)
        ? payload.features
        : (typeof payload.features === 'string'
            ? payload.features.split(',').map((f) => f.trim()).filter(Boolean)
            : []);

    const feature_flags = payload.feature_flags
        || (Array.isArray(features)
            ? Object.fromEntries(features.map((f) => [String(f).toLowerCase().replace(/\s+/g, '_'), true]))
            : {});

    const planRow = {
        name: payload.name,
        price: Number(payload.price) || 0,
        currency: payload.currency || 'USD',
        interval,
        features,
        is_active: payload.is_active !== false,
        storage_gb: payload.storage_gb != null ? Number(payload.storage_gb) : (payload.storage != null ? Number(payload.storage) : null),
        max_members: payload.max_members != null ? Number(payload.max_members) : null,
        branch_limit: payload.branch_limit != null ? Number(payload.branch_limit) : null,
        feature_flags,
        trial_days: payload.trial_days != null ? Number(payload.trial_days) : (payload.trialDays != null ? Number(payload.trialDays) : 0),
        terms: payload.terms || '',
        updated_at: new Date().toISOString()
    };

    const exists = await tableExists('subscription_plans');
    if (exists) {
        // Some DBs may not have extra columns — try full then minimal
        let { data, error } = await supabase
            .from('subscription_plans')
            .upsert({ id: payload.id || undefined, ...planRow }, { onConflict: 'name' })
            .select()
            .single();

        if (error) {
            const minimal = {
                name: planRow.name,
                price: planRow.price,
                currency: planRow.currency,
                interval: planRow.interval,
                features: planRow.features,
                is_active: planRow.is_active,
                updated_at: planRow.updated_at
            };
            const retry = await supabase
                .from('subscription_plans')
                .upsert({ id: payload.id || undefined, ...minimal }, { onConflict: 'name' })
                .select()
                .single();
            data = retry.data;
            error = retry.error;
            if (!error && data) {
                // Keep extended fields in settings mirror
                const plans = await readPlansFromSettings();
                const idx = plans.findIndex((p) => p.name === planRow.name);
                const merged = { ...planRow, id: data.id };
                if (idx >= 0) plans[idx] = { ...plans[idx], ...merged };
                else plans.push(merged);
                await writePlansToSettings(plans);
            }
        }

        if (!error && data) {
            if (actorId) {
                await supabase.from('audit_logs').insert({
                    actor_id: actorId,
                    action: 'SUBSCRIPTION_PLAN_UPSERT',
                    target_type: 'subscription_plans',
                    target_id: data.id,
                    details: planRow
                });
            }
            return { ...planRow, ...data };
        }
    }

    const plans = await listSubscriptionPlans();
    const idx = plans.findIndex((p) => p.name === planRow.name || (payload.id && p.id === payload.id));
    const saved = {
        id: payload.id || `plan-${Date.now()}`,
        ...planRow
    };
    if (idx >= 0) plans[idx] = { ...plans[idx], ...saved };
    else plans.push(saved);
    await writePlansToSettings(plans);

    if (actorId) {
        await supabase.from('audit_logs').insert({
            actor_id: actorId,
            action: 'SUBSCRIPTION_PLAN_UPSERT',
            target_type: 'subscription_plans',
            target_id: saved.id,
            details: saved
        });
    }
    return saved;
};

export const buildPlanPriceMap = async () => {
    const plans = await listSubscriptionPlans();
    const map = { ...DEFAULT_PLAN_PRICES };
    for (const p of plans) {
        if (p?.name) map[String(p.name).toLowerCase()] = Number(p.price) || 0;
    }
    return map;
};

const sumInRange = (items, amountFn, startIso, endIso) =>
    items
        .filter((item) => {
            const t = item.created_at || item.date;
            if (!t) return false;
            const iso = new Date(t).toISOString();
            return iso >= startIso && iso < endIso;
        })
        .reduce((acc, item) => acc + amountFn(item), 0);

export const computeRevenueStats = async () => {
    const priceMap = await buildPlanPriceMap();
    const billing = await readBillingConfig();
    const rate = Number(billing.marketplace_rate_percent || 0) / 100;

    const { data: spaces } = await supabase
        .from('family_spaces')
        .select('id, subscription_tier, created_at, status')
        .neq('subscription_tier', 'free');

    const { data: orders } = await supabase
        .from('orders')
        .select('id, total, status, created_at, payment_method');

    const spaceRows = spaces || [];
    const orderRows = (orders || []).filter((o) => !['refunded', 'cancelled', 'canceled'].includes(String(o.status || '').toLowerCase()));

    const spaceAmount = (s) => priceMap[String(s.subscription_tier || '').toLowerCase()] || 0;
    const orderAmount = (o) => parseFloat(o.total || 0) || 0;
    const commissionAmount = (o) => orderAmount(o) * rate;

    const now = new Date();
    const d0 = now.toISOString();
    const d7 = daysAgoIso(7);
    const d14 = daysAgoIso(14);

    const subAll = spaceRows.reduce((a, s) => a + spaceAmount(s), 0);
    const mktAll = orderRows.reduce((a, o) => a + orderAmount(o), 0);
    const commissionAll = orderRows.reduce((a, o) => a + commissionAmount(o), 0);

    const sub7 = sumInRange(spaceRows, spaceAmount, d7, d0);
    const mkt7 = sumInRange(orderRows, orderAmount, d7, d0);
    const commission7 = sumInRange(orderRows, commissionAmount, d7, d0);

    const subPrev = sumInRange(spaceRows, spaceAmount, d14, d7);
    const mktPrev = sumInRange(orderRows, orderAmount, d14, d7);
    const commissionPrev = sumInRange(orderRows, commissionAmount, d14, d7);

    const adRevenue = Number(billing.ad_revenue_manual || 0);

    const total7 = sub7 + commission7 + (adRevenue > 0 ? adRevenue / 4 : 0); // ad manual is monthly-ish; attribute a week slice lightly
    const totalPrev = subPrev + commissionPrev;

    let totalKccEarned = 0;
    try {
        const { data: ledger } = await supabase.from('kcc_ledger').select('amount').eq('type', 'earn');
        totalKccEarned = (ledger || []).reduce((acc, curr) => acc + parseFloat(curr.amount || 0), 0);
    } catch (_) { /* optional */ }

    return {
        subscription_revenue: Number(subAll.toFixed(2)),
        marketplace_revenue: Number(mktAll.toFixed(2)),
        marketplace_commissions: Number(commissionAll.toFixed(2)),
        marketplace_commissions_7d: Number(commission7.toFixed(2)),
        subscription_revenue_7d: Number(sub7.toFixed(2)),
        marketplace_revenue_7d: Number(mkt7.toFixed(2)),
        total_revenue_7d: Number(total7.toFixed(2)),
        ad_revenue: Number(adRevenue.toFixed(2)),
        total_kcc_issued: Number(totalKccEarned.toFixed(2)),
        currency: billing.currency || 'USD',
        commission_rate_percent: billing.marketplace_rate_percent,
        growth: {
            total_7d: growthPct(total7, totalPrev),
            subscriptions_7d: growthPct(sub7, subPrev),
            marketplace_7d: growthPct(commission7, commissionPrev),
            ads: adRevenue > 0 ? 'SET' : '0%'
        }
    };
};

export const buildBillingInvoices = async () => {
    const priceMap = await buildPlanPriceMap();

    const { data: spaces } = await supabase.from('family_spaces').select(`
        id, name, subscription_tier, status, created_at,
        owner:owner_id (first_name, last_name, email)
    `).neq('subscription_tier', 'free').order('created_at', { ascending: false });

    const { data: orders } = await supabase.from('orders').select(`
        id, order_number, total, status, created_at, payment_method, user_id,
        users:user_id (first_name, last_name, email)
    `).order('created_at', { ascending: false });

    const { data: refundLogs } = await supabase
        .from('audit_logs')
        .select('target_id, action, details, created_at')
        .in('action', ['BILLING_REFUND_ISSUED', 'BILLING_REFUND_REJECTED'])
        .order('created_at', { ascending: false });

    const refundedIds = new Set(
        (refundLogs || [])
            .filter((l) => l.action === 'BILLING_REFUND_ISSUED')
            .map((l) => l.target_id)
    );

    const invoices = [
        ...(spaces || []).map((s) => {
            const amount = priceMap[String(s.subscription_tier || '').toLowerCase()] || 0;
            const refunded = refundedIds.has(s.id);
            return {
                id: `SUB-${String(s.id).slice(0, 8).toUpperCase()}`,
                original_id: s.id,
                customer: s.name || (s.owner ? `${s.owner.first_name || ''} ${s.owner.last_name || ''}`.trim() : 'Family Space'),
                amount,
                amount_display: `$${amount.toFixed(2)}`,
                status: refunded ? 'Refunded' : (s.status === 'active' || !s.status ? 'Paid' : 'Pending'),
                method: 'Subscription',
                source: 'SUBSCRIPTION',
                payment_provider: 'internal',
                date: s.created_at,
                tier: s.subscription_tier
            };
        }),
        ...(orders || []).map((m) => {
            const amount = parseFloat(m.total || 0) || 0;
            const statusLower = String(m.status || '').toLowerCase();
            const refunded = refundedIds.has(m.id) || statusLower === 'refunded';
            let status = 'Pending';
            if (refunded) status = 'Refunded';
            else if (['completed', 'paid', 'succeeded'].includes(statusLower)) status = 'Paid';
            else if (['cancelled', 'canceled', 'failed'].includes(statusLower)) status = 'Pending';

            return {
                id: m.order_number || `ORD-${String(m.id).slice(0, 8).toUpperCase()}`,
                original_id: m.id,
                customer: m.users ? `${m.users.first_name || ''} ${m.users.last_name || ''}`.trim() : 'Customer',
                amount,
                amount_display: `$${amount.toFixed(2)}`,
                status,
                method: m.payment_method || 'Card / BigK Checkout',
                source: 'MARKETPLACE',
                payment_provider: 'bigk',
                date: m.created_at
            };
        })
    ].sort((a, b) => new Date(b.date) - new Date(a.date));

    return invoices;
};

const tryStripeRefund = async (amount, reason, metadata = {}) => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
        return { attempted: false, provider: 'none', status: 'recorded_local_only' };
    }
    try {
        // Prefer PaymentIntent / Charge refund when stripe_payment_id provided
        if (metadata.stripe_refund_id || metadata.payment_intent) {
            const body = new URLSearchParams();
            if (metadata.payment_intent) body.set('payment_intent', metadata.payment_intent);
            if (amount) body.set('amount', String(Math.round(Number(amount) * 100)));
            if (reason) body.set('reason', 'requested_by_customer');
            const resp = await fetch('https://api.stripe.com/v1/refunds', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${key}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body
            });
            const json = await resp.json();
            if (!resp.ok) {
                return { attempted: true, provider: 'stripe', status: 'failed', error: json.error?.message || 'Stripe refund failed' };
            }
            return { attempted: true, provider: 'stripe', status: 'succeeded', refund_id: json.id };
        }
        return { attempted: true, provider: 'stripe', status: 'skipped_no_payment_ref', note: 'No payment_intent on invoice; recorded locally.' };
    } catch (err) {
        return { attempted: true, provider: 'stripe', status: 'failed', error: err.message };
    }
};

/**
 * Process refund for subscriptions (family_spaces / platform_subscriptions) or marketplace orders.
 */
export const processBillingRefund = async ({
    subscription_id,
    subscriptionId,
    order_id,
    invoice_id,
    source,
    amount,
    reason,
    payment_intent,
    actorId,
    reject = false,
    rejection_reason
}) => {
    const targetId = subscription_id || subscriptionId || order_id || invoice_id;
    if (!targetId) throw Object.assign(new Error('subscription_id, order_id, or invoice_id is required'), { status: 400 });
    if (!reason && !reject) throw Object.assign(new Error('reason is required'), { status: 400 });
    if (reject && !rejection_reason && !reason) {
        throw Object.assign(new Error('rejection reason is required'), { status: 400 });
    }

    let resolvedSource = String(source || '').toUpperCase();
    let record = null;
    let refundAmount = amount != null ? Number(amount) : null;

    // 1) platform_subscriptions
    {
        const { data } = await supabase.from('platform_subscriptions').select('*').eq('id', targetId).maybeSingle();
        if (data) {
            resolvedSource = 'PLATFORM_SUBSCRIPTION';
            record = data;
            if (refundAmount == null) refundAmount = Number(data.amount_paid || 0);
        }
    }

    // 2) family_spaces (subscription invoices)
    if (!record) {
        const { data } = await supabase.from('family_spaces').select('*').eq('id', targetId).maybeSingle();
        if (data) {
            resolvedSource = 'SUBSCRIPTION';
            record = data;
            if (refundAmount == null) {
                const map = await buildPlanPriceMap();
                refundAmount = map[String(data.subscription_tier || '').toLowerCase()] || 0;
            }
        }
    }

    // 3) orders (marketplace)
    if (!record) {
        let orderData = null;
        const byId = await supabase.from('orders').select('*').eq('id', targetId).maybeSingle();
        if (byId.data) orderData = byId.data;
        if (!orderData) {
            const byNum = await supabase.from('orders').select('*').eq('order_number', targetId).maybeSingle();
            if (byNum.data) orderData = byNum.data;
        }
        if (orderData) {
            resolvedSource = 'MARKETPLACE';
            record = orderData;
            if (refundAmount == null) refundAmount = Number(orderData.total || 0);
        }
    }

    if (!record) {
        throw Object.assign(new Error('Invoice / subscription / order not found'), { status: 404 });
    }

    if (reject) {
        await supabase.from('audit_logs').insert({
            actor_id: actorId,
            action: 'BILLING_REFUND_REJECTED',
            target_type: resolvedSource.toLowerCase(),
            target_id: record.id,
            details: { reason: rejection_reason || reason, source: resolvedSource }
        });
        return {
            message: 'Refund request rejected',
            target_id: record.id,
            source: resolvedSource,
            status: 'rejected'
        };
    }

    const stripeResult = await tryStripeRefund(refundAmount, reason, {
        payment_intent: payment_intent || record.payment_intent || record.stripe_payment_intent || null
    });

    if (resolvedSource === 'MARKETPLACE') {
        await supabase.from('orders').update({ status: 'refunded' }).eq('id', record.id);
    } else if (resolvedSource === 'PLATFORM_SUBSCRIPTION') {
        await supabase
            .from('platform_subscriptions')
            .update({ status: 'refunded' })
            .eq('id', record.id);
    } else if (resolvedSource === 'SUBSCRIPTION') {
        // Downgrade space marker — keep history via audit
        await supabase
            .from('family_spaces')
            .update({ subscription_tier: 'free' })
            .eq('id', record.id);
    }

    await supabase.from('audit_logs').insert({
        actor_id: actorId,
        action: 'BILLING_REFUND_ISSUED',
        target_type: resolvedSource.toLowerCase(),
        target_id: record.id,
        details: {
            amount: refundAmount,
            reason,
            source: resolvedSource,
            stripe: stripeResult,
            full_refund: amount == null
        }
    });

    return {
        message: stripeResult.status === 'succeeded'
            ? 'Refund processed via Stripe'
            : 'Refund recorded. Provider reverse completed locally' + (stripeResult.attempted ? ` (${stripeResult.status})` : ' (set STRIPE_SECRET_KEY for live Stripe refunds).'),
        target_id: record.id,
        source: resolvedSource,
        refund_amount: refundAmount,
        reason,
        provider: stripeResult
    };
};

/**
 * Resolve entitlements for a family space based on its plan tier.
 */
export const getFamilyPlanEntitlements = async (familySpaceId) => {
    const { data: space } = await supabase
        .from('family_spaces')
        .select('subscription_tier, storage_quota_bytes')
        .eq('id', familySpaceId)
        .maybeSingle();

    const tier = String(space?.subscription_tier || 'free').toLowerCase();
    const plans = await listSubscriptionPlans();
    const plan = plans.find((p) => String(p.name).toLowerCase() === tier)
        || plans.find((p) => String(p.name).toLowerCase().includes(tier))
        || null;

    const flags = plan?.feature_flags || {};
    return {
        family_space_id: familySpaceId,
        tier,
        plan: plan || null,
        features: plan?.features || [],
        feature_flags: flags,
        limits: {
            storage_gb: plan?.storage_gb ?? null,
            max_members: plan?.max_members ?? null,
            branch_limit: plan?.branch_limit ?? null,
            storage_quota_bytes: space?.storage_quota_bytes ?? null
        },
        hasFeature: (key) => {
            if (!key) return true;
            const k = String(key).toLowerCase();
            if (Object.prototype.hasOwnProperty.call(flags, k)) return !!flags[k];
            return (plan?.features || []).some((f) => String(f).toLowerCase().includes(k));
        }
    };
};

/**
 * Auditor financial console — real invoices + revenue (shared Business billing ledger).
 */
export const buildAuditorBillingSnapshot = async () => {
    const [invoices, revenue, billingConfig, refundRes] = await Promise.all([
        buildBillingInvoices(),
        computeRevenueStats(),
        readBillingConfig(),
        supabase
            .from('audit_logs')
            .select('id, action, target_id, details, created_at, actor_id')
            .in('action', ['BILLING_REFUND_ISSUED', 'BILLING_REFUND_REJECTED'])
            .order('created_at', { ascending: false })
            .limit(100)
    ]);

    const refundLogs = refundRes?.data || [];

    const refundByTarget = {};
    for (const log of refundLogs) {
        if (!log?.target_id) continue;
        if (!refundByTarget[log.target_id]) refundByTarget[log.target_id] = log;
    }

    const fourteenDayMs = 14 * 24 * 60 * 60 * 1000;

    const transactions = invoices.map((inv) => {
        const refund = refundByTarget[inv.original_id];
        const amountNum = Number(inv.amount) || 0;
        const ageMs = inv.date ? Date.now() - new Date(inv.date).getTime() : 0;
        const reasons = [];

        if (inv.status === 'Refunded') reasons.push('Refund issued');
        if (inv.status === 'Pending' && ageMs > fourteenDayMs) reasons.push('Pending > 14 days');
        if (inv.status === 'Paid' && amountNum <= 0) reasons.push('Zero-amount Paid invoice');
        if (String(inv.method || '').toLowerCase().includes('unknown')) reasons.push('Unknown payment method');

        const isAnomaly = reasons.length > 0;

        const typeLabel = inv.source === 'MARKETPLACE'
            ? 'Marketplace Order'
            : (inv.tier
                ? `${String(inv.tier).charAt(0).toUpperCase()}${String(inv.tier).slice(1)} Plan`
                : 'Subscription');

        return {
            id: inv.id,
            original_id: inv.original_id,
            org: inv.customer || 'Unknown',
            amount: inv.amount_display || `$${amountNum.toFixed(2)}`,
            amount_value: amountNum,
            status: inv.status,
            date: inv.date ? new Date(inv.date).toISOString().split('T')[0] : '',
            method: inv.method || '—',
            type: typeLabel,
            source: inv.source || 'SUBSCRIPTION',
            payment_provider: inv.payment_provider || 'internal',
            ref: inv.original_id ? String(inv.original_id).slice(0, 8).toUpperCase() : inv.id,
            tier: inv.tier || null,
            isAnomaly,
            anomalyReasons: reasons,
            auditReason: reasons[0] || refund?.details?.reason || null,
            refund_reason: refund?.details?.reason || null,
            refund_action: refund?.action || null,
            refund_at: refund?.created_at || null
        };
    });

    const pendingSettlement = transactions.filter((t) => t.status === 'Pending').length;
    const refundedCount = transactions.filter((t) => t.status === 'Refunded').length;
    const anomalies = transactions.filter((t) => t.isAnomaly).length;
    const anomalyRate = transactions.length
        ? Number(((anomalies / transactions.length) * 100).toFixed(1))
        : 0;

    const totalLedger = Number(
        (
            (revenue.subscription_revenue || 0)
            + (revenue.marketplace_commissions || 0)
            + (revenue.ad_revenue || 0)
        ).toFixed(2)
    );

    return {
        metrics: {
            totalRevenue: totalLedger,
            subscriptionRevenue: revenue.subscription_revenue || 0,
            marketplaceRevenue: revenue.marketplace_revenue || 0,
            marketplaceCommissions: revenue.marketplace_commissions || 0,
            adRevenue: revenue.ad_revenue || 0,
            anomalyRate,
            anomalyCount: anomalies,
            pendingRefunds: pendingSettlement,
            refundedCount,
            invoiceCount: transactions.length,
            currency: revenue.currency || billingConfig.currency || 'USD',
            commissionRatePercent: revenue.commission_rate_percent ?? billingConfig.marketplace_rate_percent,
            growth: revenue.growth || {}
        },
        transactions,
        refund_activity: refundLogs.map((l) => ({
            id: l.id,
            action: l.action,
            target_id: l.target_id,
            reason: l.details?.reason || null,
            amount: l.details?.amount ?? null,
            source: l.details?.source || null,
            created_at: l.created_at
        })),
        generated_at: new Date().toISOString()
    };
};
