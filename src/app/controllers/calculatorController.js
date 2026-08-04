import relationship from 'relationship.js';
import { PATH_TO_CHINESE_MAP, KINSHIP_DICT } from '../../utils/kinshipDictionary.js';
import { supabase } from '../../config/supabaseClient.js';

const getInternalKinship = (path, sex) => {
    const steps = path.filter(p => p.toLowerCase() !== 'me');
    
    if (steps.length === 0) {
        return {
            chinese_term: '我',
            english_term: 'Me',
            meaning: 'Yourself'
        };
    }

    const chineseSteps = steps.map(step => PATH_TO_CHINESE_MAP[step.toLowerCase()] || step);
    const textQuery = chineseSteps.join('的');
    const result = relationship({ text: textQuery, sex });
    
    if (!result || result.length === 0) {
        return {
            chinese_term: '未知',
            english_term: 'Unknown',
            meaning: 'Relationship too complex, distant, or unknown.'
        };
    }
    
    const zhTerm = result[0];
    const dictEntry = KINSHIP_DICT[zhTerm];
    
    return {
        chinese_term: zhTerm,
        english_term: dictEntry ? dictEntry.en : 'Extended Relative',
        meaning: dictEntry ? dictEntry.meaning : 'Extended Family Member'
    };
};

// 1. Calculate Relationship (Add Step)
// Called when user clicks a card (Father, Mother, etc) or "Calculate Relationship"
export const addStep = async (req, res) => {
    try {
        const { path = [], next_step } = req.body;
        
        let newPath = [...path];
        if (newPath.length === 0) newPath = ['Me'];
        if (next_step) newPath.push(next_step);

        let sex = 1;
        if (req.user) {
            const { data: user } = await supabase.from('users').select('gender').eq('id', req.user.id).single();
            if (user && user.gender === 'female') sex = 0;
        }

        console.log('[addStep] path:', newPath, 'sex:', sex);
        const preview = getInternalKinship(newPath, sex);

        return res.json({
            current_path: newPath,
            preview_result: {
                title: preview.english_term,
                isImage: false,
                icon: null
            },
            details: preview
        });
    } catch (err) {
        console.error('[addStep] Error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

// 2. Kinship Results (Calculator Results)
// Called to render the final results page
export const getResults = async (req, res) => {
    try {
        // Support both POST (req.body.path) and GET (req.query.path like ?path=Me,Father,Mother)
        let path = req.body ? req.body.path : undefined;
        
        if (req.method === 'GET' && req.query.path) {
            path = req.query.path.split(',');
        }

        if (!path || !Array.isArray(path)) {
            return res.status(400).json({ error: 'Valid path array (or comma-separated query param) is required' });
        }

        let sex = 1;
        let myAvatar = null;
        let myIsImage = false;

        if (req.user) {
            const { data: user, error } = await supabase.from('users').select('gender, avatar_url, first_name, last_name').eq('id', req.user.id).single();
            if (user) {
                if (user.gender === 'female') sex = 0;
                if (user.avatar_url) {
                    myAvatar = user.avatar_url;
                    myIsImage = true;
                }
            }
        }

        console.log('[getResults] path:', path, 'sex:', sex);
        const result = getInternalKinship(path, sex);

        return res.json({
            path_steps: [
                ...path.map(p => {
                    const cleanP = p.replace(/_[+-]/g, '');
                    const isMe = cleanP.toLowerCase() === 'me';
                    return { 
                        title: cleanP, 
                        isImage: isMe ? myIsImage : false, 
                        icon: isMe ? myAvatar : null
                    };
                }),
                { 
                    title: result.english_term, 
                    isImage: false, 
                    icon: null 
                }
            ],
            details: result
        });
    } catch (err) {
        console.error('[getResults] Error:', err);
        return res.status(500).json({ error: 'Internal server error calculating results' });
    }
};

// 3. Edit Path
// Called when user clicks "Edit Path" to remove the last step
export const editPath = async (req, res) => {
    try {
        const { path } = req.body;

        if (!path || !Array.isArray(path)) {
            return res.status(400).json({ error: 'Valid path array is required' });
        }

        // Pop the last step (edit this time, not add)
        let newPath = [...path];
        if (newPath.length > 1) { // Don't pop 'Me'
            newPath.pop();
        }

        let sex = 1;
        if (req.user) {
            const { data: user } = await supabase.from('users').select('gender').eq('id', req.user.id).single();
            if (user && user.gender === 'female') sex = 0;
        }

        const preview = getInternalKinship(newPath, sex);

        return res.json({
            current_path: newPath,
            preview_result: {
                title: preview.english_term,
                isImage: false,
                icon: null
            },
            details: preview
        });
    } catch (err) {
        console.error('[editPath] Error:', err);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
