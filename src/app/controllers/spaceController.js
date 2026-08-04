import { supabase } from '../../config/supabaseClient.js';

/**
 * List all family spaces for the authenticated user.
 * Includes member counts for each space.
 */
export const listSpaces = async (req, res) => {
    try {
        const userId = req.user.id;
        const currentSpaceId = req.query.current_space_id || req.headers['x-family-space-id'];

        // 1. Get all spaces the user belongs to
        const { data: memberships, error: membershipError } = await supabase
            .from('family_memberships')
            .select(`
                role,
                family_spaces (
                    id,
                    name,
                    description,
                    status
                )
            `)
            .eq('user_id', userId);

        if (membershipError) throw membershipError;

        if (!memberships || memberships.length === 0) {
            return res.status(200).json({ currentSpace: null, otherSpaces: [] });
        }

        // 2. Fetch member counts for these spaces
        const spaceIds = memberships.map(m => m.family_spaces.id);
        const { data: memberCounts, error: countError } = await supabase
            .from('family_memberships')
            .select('family_space_id');
        
        if (countError) throw countError;

        // Tally up counts
        const countMap = {};
        spaceIds.forEach(id => countMap[id] = 0);
        memberCounts.forEach(row => {
            if (countMap[row.family_space_id] !== undefined) {
                countMap[row.family_space_id]++;
            }
        });

        // 3. Format response
        const formattedSpaces = memberships.map(m => ({
            id: m.family_spaces.id,
            name: m.family_spaces.name,
            description: m.family_spaces.description,
            role: m.role,
            memberCount: countMap[m.family_spaces.id],
            // Hardcoding online for demo purposes as real-time tracking is complex for this scope
            onlineStatus: true 
        }));

        let currentSpace = null;
        let otherSpaces = [];

        if (currentSpaceId) {
            currentSpace = formattedSpaces.find(s => s.id === currentSpaceId) || null;
            otherSpaces = formattedSpaces.filter(s => s.id !== currentSpaceId);
        } else {
            // Default to first space if no current space specified
            currentSpace = formattedSpaces[0] || null;
            otherSpaces = formattedSpaces.slice(1);
        }

        return res.status(200).json({
            currentSpace,
            otherSpaces
        });

    } catch (error) {
        console.error('[listSpaces] Error:', error);
        return res.status(500).json({ error: 'Internal server error fetching spaces' });
    }
};

/**
 * Validate and switch to a new family space.
 * App provides target_space_id.
 */
export const switchSpace = async (req, res) => {
    try {
        const userId = req.user.id;
        const { target_space_id } = req.body;

        if (!target_space_id) {
            return res.status(400).json({ error: 'target_space_id is required' });
        }

        // Verify user belongs to the target space
        const { data: membership, error } = await supabase
            .from('family_memberships')
            .select('role, family_spaces(id, name)')
            .eq('user_id', userId)
            .eq('family_space_id', target_space_id)
            .single();

        if (error || !membership) {
            return res.status(403).json({ error: 'User does not have access to this space' });
        }

        // Return success response with space data to update app state
        return res.status(200).json({
            success: true,
            message: 'Successfully switched space',
            space: {
                id: membership.family_spaces.id,
                name: membership.family_spaces.name,
                role: membership.role
            }
        });

    } catch (error) {
        console.error('[switchSpace] Error:', error);
        return res.status(500).json({ error: 'Internal server error switching space' });
    }
};
