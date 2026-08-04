import { UserService } from '../../services/userService.js';

export const getMe = async (req, res) => {
    try {
        const data = await UserService.getMe(req.user.id);
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
