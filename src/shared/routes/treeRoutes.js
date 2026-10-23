import express from 'express';
import {
    searchTreeMembers,
    getTreeData,
    addParent,
    addChild,
    addFamilyMember,
    updatePerson,
    getTreeWebviewUrl
} from '../controllers/treeController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFamilyRole, requirePlatformRole, optionalPlatformAdmin } from '../../middleware/rbacMiddleware.js';

const router = express.Router();

// Get full tree data (Requires Auth, handles internal RBAC for Admin vs Member)
router.get('/data', authMiddleware, optionalPlatformAdmin, getTreeData);

// After Google login the web app calls this with no family id and no bearer
// token. A 401 makes the app erase the new session and show Sign Up again.
const ignoreEmptyWebviewLookup = (req, res, next) => {
    const familyId = String(req.query.family_space_id || '').trim();
    const header = String(req.headers.authorization || '');
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const missingFamily = !familyId || familyId === 'null' || familyId === 'undefined';
    const missingToken = !token || token === 'null' || token === 'undefined';
    if (missingFamily || missingToken) {
        return res.json({ url: null });
    }
    return next();
};

// Mobile app WebView entry URL (admin SPA + token + family space)
router.get('/webview-url', ignoreEmptyWebviewLookup, authMiddleware, getTreeWebviewUrl);

// All tree operations require at least Member role (Guests blocked).
// Non-admin edits are intercepted and turned into requests by the controller based on governance mode.
router.post('/add-parent', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), addParent);
router.post('/add-child', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), addChild);
router.post('/add-member', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), addFamilyMember);
router.patch('/person/:person_id', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), updatePerson);

// Search is available to all members
router.get('/search', authMiddleware, searchTreeMembers);

export default router;
