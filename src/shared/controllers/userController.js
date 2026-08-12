import { UserService } from '../../services/userService.js';

export const getMe = async (req, res) => {
    try {
        const familySpaceId = req.query.family_space_id || req.headers['x-family-space-id'] || null;
        const data = await UserService.getMe(req.user.id, { familySpaceId });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

export const updateMe = async (req, res) => {
    try {
        const data = await UserService.updateMe(req.user.id, req.body);
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
