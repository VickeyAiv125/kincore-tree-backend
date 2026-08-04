import express from 'express';
import {
    getBranches,
    createBranch,
    deleteBranch,
    getBranchById,
    updateBranch,
    getBranchLimitStatus
} from '../controllers/branchController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFamilyRole } from '../../middleware/rbacMiddleware.js';

import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

// All branch routes require being a member of the family
// Create/Delete/Update require Owner/Admin roles
router.get('/:id', authMiddleware, getBranches);
router.get('/single/:id', authMiddleware, getBranchById);
router.get('/limit-status/:id', authMiddleware, getBranchLimitStatus);
router.post('/', authMiddleware, upload.single('emblem'), requireFamilyRole('family_space_id', ['owner', 'admin']), createBranch);
router.patch('/:id', authMiddleware, upload.single('emblem'), requireFamilyRole('family_space_id', ['owner', 'admin', 'branch-admin']), updateBranch);
router.delete('/:id', authMiddleware, deleteBranch);

export default router;
