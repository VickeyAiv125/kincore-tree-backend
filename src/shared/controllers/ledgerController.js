import { supabase } from '../../config/supabaseClient.js';
import { clientApi } from '../../services/clientApiService.js';

/**
 * Get user's current KCC balance (Proxy to BigK).
 */
export const getMyBalance = async (req, res) => {
    try {
        const { user } = req;
        const authHeader = req.headers.authorization;

        // Fresh balance from BigK (Source of Truth)
        const externalData = await clientApi.getWalletDetails(authHeader.split(' ')[1]);
        res.json(externalData.wallet || { balance: 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Get user's transaction history (Local synced ledger).
 */
export const getHistory = async (req, res) => {
    try {
        const { user } = req;

        const { data, error } = await supabase
            .from('kcc_ledger')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

/**
 * Transfer coins and sync locally.
 */
export const transferCoins = async (req, res) => {
    try {
        const { recipient_handle, amount, note } = req.body;
        const { user } = req;
        const authHeader = req.headers.authorization;

        const externalTx = await clientApi.transferCoins(
            authHeader.split(' ')[1],
            recipient_handle,
            amount,
            note
        );

        const { data, error } = await supabase
            .from('kcc_ledger')
            .insert({
                user_id: user.id,
                wallet_id: user.wallet_id || 0,
                type: 'transfer',
                amount: -Math.abs(amount),
                reason: note,
                external_transaction_id: externalTx.transaction_id || null,
                status: 'confirmed'
            })
            .select()
            .single();

        if (error) throw error;
        res.json({ message: 'Transfer successful', local_record: data, external_tx: externalTx });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
