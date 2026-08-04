import { supabase } from '../config/supabaseClient.js';
import { tableExists, readJsonDb } from '../utils/dbHelper.js';

export const requireGovernanceUnlocked = (familySpaceIdParam = 'id') => {
    return async (req, res, next) => {
        try {
            let familySpaceId = req.params[familySpaceIdParam] || req.body[familySpaceIdParam] || req.query[familySpaceIdParam];
            
            if (!familySpaceId) {
                return res.status(400).json({ error: 'Family Space ID is required to verify governance lock.' });
            }

            const hasTable = await tableExists('sensitive_changes');
            let changes = [];

            if (hasTable) {
                const { data, error } = await supabase
                    .from('sensitive_changes')
                    .select('status')
                    .eq('family_space_id', familySpaceId)
                    .eq('change_type', 'Governance Lock')
                    .eq('status', 'approved');
                
                if (!error && data) {
                    changes = data;
                }
            } else {
                const db = readJsonDb();
                changes = (db.sensitive_changes || []).filter(c => 
                    c.family_space_id === familySpaceId && 
                    c.change_type === 'Governance Lock' && 
                    c.status === 'approved'
                );
            }

            if (changes.length > 0) {
                return res.status(403).json({ 
                    error: 'Governance Lock is currently ENABLED. This sensitive action requires council consensus and cannot be performed right now.', 
                    isGovernanceLocked: true 
                });
            }

            next();
        } catch (err) {
            console.error('Governance Lock Check Error:', err);
            res.status(500).json({ error: 'Failed to verify Governance Lock status.' });
        }
    };
};
