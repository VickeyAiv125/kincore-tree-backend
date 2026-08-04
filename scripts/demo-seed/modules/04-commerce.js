import { DEMO } from '../lib/ids.js';
import { upsert } from '../lib/upsert.js';
import { log, sb, warn } from '../lib/supabase.js';

/**
 * Marketplace, orders, KCC ledger, ads, fees, subscriptions (Business + Mall).
 */
export async function seedCommerce(byEmail) {
    log('--- commerce / mall / KCC / billing ---');
    const seller = byEmail['seller@demo.kincore'];
    const member1 = byEmail['member1@demo.kincore'];
    const member2 = byEmail['member2@demo.kincore'];
    const owner = byEmail['owner@admin.com'];
    const business = byEmail['business@admin.com'];

    await upsert('marketplace_listings', [
        {
            id: DEMO.listing1,
            seller_id: seller.id,
            family_space_id: DEMO.spaceId,
            title: 'Handmade Ceramic Tea Set (Demo)',
            price: 48.0,
            category: 'home',
            condition: 'new',
            location: 'Singapore',
            description: 'Demo approved listing for Family Mall.',
            image_urls: ['https://placehold.co/600x400/png?text=Tea+Set'],
            is_negotiable: true,
            status: 'active',
            moderation_status: 'approved',
            family_moderation_status: 'approved'
        },
        {
            id: DEMO.listing2,
            seller_id: seller.id,
            family_space_id: DEMO.spaceId,
            title: 'Vintage Family Photo Album (Demo)',
            price: 25.0,
            category: 'collectibles',
            condition: 'used',
            location: 'Singapore',
            description: 'Pending family moderation — for Family Admin review demos.',
            image_urls: ['https://placehold.co/600x400/png?text=Album'],
            is_negotiable: false,
            status: 'pending',
            moderation_status: 'pending',
            family_moderation_status: 'pending'
        },
        {
            id: DEMO.listing3,
            seller_id: member2.id,
            family_space_id: DEMO.spaceId,
            title: 'Rejected Demo Listing',
            price: 10.0,
            category: 'other',
            condition: 'used',
            location: 'Johor',
            description: 'Rejected for policy demo.',
            image_urls: [],
            is_negotiable: false,
            status: 'rejected',
            moderation_status: 'rejected',
            family_moderation_status: 'rejected'
        }
    ], { onConflict: 'id' });

    const orderRows = [
        {
            id: DEMO.order1,
            user_id: member1.id,
            order_number: 'DEMO-ORD-1001',
            external_order_id: 1001,
            items: [{ listing_id: DEMO.listing1, title: 'Handmade Ceramic Tea Set (Demo)', qty: 1, price: 48 }],
            subtotal: 48,
            shipping_fee: 5,
            kcc_discount: 3,
            total: 50,
            status: 'paid',
            shipping_address: { line1: '1 Demo Street', city: 'Singapore', country: 'SG' },
            tracking_number: 'DEMO-TRACK-001'
        },
        {
            id: DEMO.order2,
            user_id: member2.id,
            order_number: 'DEMO-ORD-1002',
            external_order_id: 1002,
            items: [{ listing_id: DEMO.listing1, title: 'Handmade Ceramic Tea Set (Demo)', qty: 1, price: 48 }],
            subtotal: 48,
            shipping_fee: 5,
            kcc_discount: 0,
            total: 53,
            status: 'refunded',
            shipping_address: { line1: '2 Demo Ave', city: 'Johor', country: 'MY' }
        }
    ];

    // Unique on order_number — clear prior demo numbers then upsert by id
    await sb.from('orders').delete().in('order_number', ['DEMO-ORD-1001', 'DEMO-ORD-1002']);
    const { error: orderErr } = await sb.from('orders').upsert(orderRows, { onConflict: 'id' });
    if (orderErr) warn('upsert orders failed:', orderErr.message);
    else log('✓ orders (2)');

    await upsert('kcc_ledger', [
        {
            id: DEMO.kcc1,
            user_id: owner.id,
            wallet_id: 10001,
            type: 'earn',
            amount: 500,
            reason: 'Demo welcome bonus',
            external_reference: 'DEMO-KCC-EARN-1',
            status: 'completed'
        },
        {
            id: DEMO.kcc2,
            user_id: member1.id,
            wallet_id: 10002,
            type: 'earn',
            amount: 120,
            reason: 'Demo event attendance reward',
            external_reference: 'DEMO-KCC-EARN-2',
            status: 'completed'
        },
        {
            id: DEMO.kcc3,
            user_id: member1.id,
            wallet_id: 10002,
            type: 'spend',
            amount: 30,
            reason: 'Demo mall discount',
            external_transaction_id: 'DEMO-ORD-1001',
            external_reference: 'DEMO-KCC-SPEND-1',
            status: 'completed'
        }
    ], { onConflict: 'id' });

    await upsert('ad_campaigns', {
        id: DEMO.campaign1,
        advertiser_id: business.id,
        title: 'PlenorHub Partner Promo (Demo)',
        description: 'Pending campaign for Business Ads review.',
        placement: 'family_feed',
        start_date: new Date().toISOString().slice(0, 10),
        end_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        total_cost_kcc: 200,
        daily_kcc_rate: 10,
        status: 'pending',
        payment_status: 'pending',
        target_audience: { regions: ['SG', 'MY'], demo: true },
        media_url: 'https://placehold.co/1200x300/png?text=Ad+Demo'
    }, { onConflict: 'id' });

    await upsert('fee_structures', {
        id: DEMO.feeId,
        p2p_transfer_fee: 1.5,
        mall_transaction_fee: 2.5,
        liquidity_exit_fee: 1.0,
        updated_at: new Date().toISOString()
    }, { onConflict: 'id' });

    await upsert('subscription_plans', [
        {
            id: DEMO.subPlanStd,
            name: 'Demo Standard',
            price: 19.99,
            currency: 'USD',
            interval: 'month',
            features: ['Basic Features', '10GB Storage', 'Demo'],
            is_active: true
        },
        {
            id: DEMO.subPlanPrem,
            name: 'Demo Premium',
            price: 49.99,
            currency: 'USD',
            interval: 'month',
            features: ['Advanced Features', '50GB Storage', 'Priority Support', 'Demo'],
            is_active: true
        }
    ], { onConflict: 'id' });

    await upsert('platform_subscriptions', {
        id: DEMO.platformSub1,
        user_id: owner.id,
        plan_type: 'premium',
        amount_paid: 49.99,
        currency: 'USD',
        status: 'active',
        next_billing_at: new Date(Date.now() + 25 * 86400000).toISOString(),
        feature_gates: { storage: true, exports: true, trees: true, demo: true }
    }, { onConflict: 'id' });

    await upsert('platform_settings', [
        {
            id: 'a4100000-0000-4000-8000-000000000001',
            key: 'demo.seeded_at',
            value: { at: new Date().toISOString(), tag: DEMO.tag },
            description: 'Timestamp of last demo seed run'
        },
        {
            id: 'a4100000-0000-4000-8000-000000000002',
            key: 'demo.family_space_id',
            value: { space_id: DEMO.spaceId, code: 'CHEN-DEMO' },
            description: 'Primary demo family space'
        }
    ], { onConflict: 'id' });
}
