import { supabase } from '../../config/supabaseClient.js';
import { logActivity } from '../../utils/logger.js';
import crypto from 'crypto';

// MOCK BIGK API FOR KCC COIN
const mockBigKApi = {
    checkBalance: async (userId) => {
        // Mock: Assume user always has enough balance for now
        return { success: true, balance: 10000 };
    },
    reserveCoins: async (userId, amount) => {
        // Mock: Reserve coins and return a fake transaction ID
        return { success: true, transactionId: `KCC-RES-${crypto.randomUUID().substring(0, 8).toUpperCase()}` };
    },
    releaseCoins: async (transactionId) => {
        return { success: true };
    },
    deductCoins: async (transactionId) => {
        return { success: true };
    }
};

export const createCampaign = async (req, res) => {
    try {
        const { title, description, placement, start_date, end_date, target_audience, media_url, daily_kcc_rate } = req.body;
        let advertiserId = req.user.id;

        // If admin/business user, allow them to specify a different advertiser_id
        const { data: adminRecord } = await supabase.from('admin_users').select('role').eq('user_id', req.user.id).maybeSingle();
        let userRole = adminRecord?.role || '';
        if (!userRole && req.user.email) {
            const DEFAULT_ADMINS = {
                'family@admin.com': 'superadmin',
                'owner@admin.com': 'owner',
                'council@admin.com': 'council',
                'branch@admin.com': 'branch-admin',
                'business@admin.com': 'business',
                'devops@admin.com': 'devops',
                'auditor@admin.com': 'auditor'
            };
            userRole = DEFAULT_ADMINS[req.user.email.toLowerCase()] || '';
        }

        if (['superadmin', 'super_admin', 'admin', 'business'].includes(userRole) && req.body.advertiser_id) {
            advertiserId = req.body.advertiser_id;
        }

        if (!title || !placement || !start_date || !end_date) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Calculate KCC Cost using dynamic rate
        const days = Math.ceil((new Date(end_date) - new Date(start_date)) / (1000 * 60 * 60 * 24));
        const dailyRate = Number(daily_kcc_rate) || (placement === 'banner' ? 50 : placement === 'sidebar' ? 30 : 20);
        const totalCost = days * dailyRate;

        if (totalCost <= 0) {
            return res.status(400).json({ error: 'Invalid date range' });
        }

        // Temporarily bypassing wallet balance check since KCC isn't live yet
        // Reserve coins (Mock)
        const reserveRes = await mockBigKApi.reserveCoins(advertiserId, totalCost);
        if (!reserveRes.success) {
            return res.status(500).json({ error: 'Failed to reserve KCC coins' });
        }

        const { data, error } = await supabase
            .from('ad_campaigns')
            .insert([{
                advertiser_id: advertiserId,
                title,
                description,
                placement,
                start_date,
                end_date,
                daily_kcc_rate: dailyRate,
                total_cost_kcc: totalCost,
                status: 'pending',
                payment_status: 'reserved',
                kcc_transaction_id: reserveRes.transactionId,
                target_audience,
                media_url
            }])
            .select()
            .single();

        if (error) throw error;

        await logActivity(advertiserId, 'CAMPAIGN_CREATED', `Created ad campaign: ${title}`);

        res.status(201).json({ message: 'Campaign created and coins reserved', campaign: data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const getCampaigns = async (req, res) => {
    try {
        const { status } = req.query;
        let query = supabase.from('ad_campaigns').select('*');

        const { data: adminRecord } = await supabase.from('admin_users').select('role').eq('user_id', req.user.id).maybeSingle();
        let userRole = adminRecord?.role || '';
        if (!userRole && req.user.email) {
            const DEFAULT_ADMINS = {
                'family@admin.com': 'superadmin',
                'owner@admin.com': 'owner',
                'council@admin.com': 'council',
                'branch@admin.com': 'branch-admin',
                'business@admin.com': 'business',
                'devops@admin.com': 'devops',
                'auditor@admin.com': 'auditor'
            };
            userRole = DEFAULT_ADMINS[req.user.email.toLowerCase()] || '';
        }

        // If not admin, only show own campaigns
        if (!['superadmin', 'super_admin', 'admin', 'business'].includes(userRole)) {
            query = query.eq('advertiser_id', req.user.id);
        }

        if (status && status !== 'all') {
            query = query.eq('status', status);
        }

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        res.json({ campaigns: data || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const reviewCampaign = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { action, reason } = req.body; // action: 'approve', 'reject'
        const adminId = req.user.id;

        const { data: adminRecord } = await supabase.from('admin_users').select('role').eq('user_id', req.user.id).maybeSingle();
        let userRole = adminRecord?.role || '';
        if (!userRole && req.user.email) {
            const DEFAULT_ADMINS = {
                'family@admin.com': 'superadmin',
                'owner@admin.com': 'owner',
                'council@admin.com': 'council',
                'branch@admin.com': 'branch-admin',
                'business@admin.com': 'business',
                'devops@admin.com': 'devops',
                'auditor@admin.com': 'auditor'
            };
            userRole = DEFAULT_ADMINS[req.user.email.toLowerCase()] || '';
        }

        if (!['superadmin', 'super_admin', 'admin', 'business'].includes(userRole)) {
            return res.status(403).json({ error: 'Unauthorized to review campaigns' });
        }

        const { data: campaign, error: fetchErr } = await supabase
            .from('ad_campaigns')
            .select('*')
            .eq('id', campaignId)
            .single();

        if (fetchErr || !campaign) throw new Error('Campaign not found');
        if (campaign.status !== 'pending') {
            return res.status(400).json({ error: `Campaign is already ${campaign.status}` });
        }

        let newStatus = '';
        let newPaymentStatus = campaign.payment_status;

        if (action === 'approve') {
            newStatus = 'scheduled';
            // Deduct coins permanently
            await mockBigKApi.deductCoins(campaign.kcc_transaction_id);
            newPaymentStatus = 'deducted';
        } else if (action === 'reject') {
            newStatus = 'rejected';
            // Release reserved coins
            await mockBigKApi.releaseCoins(campaign.kcc_transaction_id);
            newPaymentStatus = 'refunded';
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }

        const { data: updated, error: updateErr } = await supabase
            .from('ad_campaigns')
            .update({ 
                status: newStatus,
                payment_status: newPaymentStatus,
                updated_at: new Date().toISOString()
            })
            .eq('id', campaignId)
            .select()
            .single();

        if (updateErr) throw updateErr;

        await logActivity(adminId, 'CAMPAIGN_REVIEWED', `Campaign ${action}d: ${campaign.title}`);

        res.json({ message: `Campaign ${action}d successfully`, campaign: updated });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
