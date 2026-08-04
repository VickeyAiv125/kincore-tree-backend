import express from 'express';
import { submitClaim, resolveClaim, getFamilyApprovals } from '../controllers/claimController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFamilyRole } from '../../middleware/rbacMiddleware.js';

const router = express.Router();

// Only members and admins can submit a claim (Guests are blocked)
router.post('/', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch admin', 'member']), submitClaim);

// Only admins can resolve claims for a specific family space
router.post('/resolve', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch admin']), resolveClaim);

// Admin view for identity approvals in a family space
router.get('/approvals', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch admin']), getFamilyApprovals);

export default router;
