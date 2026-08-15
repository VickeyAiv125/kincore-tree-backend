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

// Mobile app WebView entry URL (admin SPA + token + family space)
router.get('/webview-url', authMiddleware, getTreeWebviewUrl);

// All tree operations require at least Member role (Guests blocked).
// Non-admin edits are intercepted and turned into requests by the controller based on governance mode.
router.post('/add-parent', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), addParent);
router.post('/add-child', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), addChild);
router.post('/add-member', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), addFamilyMember);
router.patch('/person/:person_id', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin', 'editor', 'member']), updatePerson);

// Search is available to all members
router.get('/search', authMiddleware, searchTreeMembers);

export default router;
