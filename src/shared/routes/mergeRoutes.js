import express from 'express';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requirePlatformRole } from '../../middleware/rbacMiddleware.js';
import { 
    suggestMerge, 
    getMergePreview, 
    initiateMergeRequest, 
    respondToMergeRequest, 
    resolveMergeConflicts, 
    executeMerge,
    searchFamilies,
    getOwnerMergeRequests
} from '../controllers/mergeController.js';

const router = express.Router();

// 1. Suggest a merge (All authenticated users can suggest)
router.post('/suggestions', authMiddleware, suggestMerge);

// 2. Get Preview (Owners only - checked in controller)
router.get('/preview', authMiddleware, getMergePreview);

// 3. Search Families for Merge
router.get('/search-families', authMiddleware, searchFamilies);

// 4. Get Owner Merge Requests (checked in controller)
router.get('/requests', authMiddleware, getOwnerMergeRequests);

// 5. Initiate Merge Request (Owners only - checked in controller)
router.post('/request', authMiddleware, initiateMergeRequest);

// 6. Respond to Merge Request (Target Owner only - checked in controller)
router.post('/request/:id/respond', authMiddleware, respondToMergeRequest);

// 7. Resolve Conflicts (Governance/Council - keep platform role for this one)
router.post('/request/:id/resolve', authMiddleware, requirePlatformRole(['super_admin', 'council']), resolveMergeConflicts);

// 8. Execute Merge (checked in controller/requires high privs)
router.post('/request/:id/execute', authMiddleware, executeMerge);

export default router;
