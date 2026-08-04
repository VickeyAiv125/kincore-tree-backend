import express from 'express';
import { getHistory, createHistoryChapter, getMigrationHistory, getMigrationRouteDetails } from '../controllers/historyController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFamilyRole } from '../../middleware/rbacMiddleware.js';

const router = express.Router();

const anyRole = ['owner', 'admin', 'branch admin', 'member', 'guest'];

router.get('/', authMiddleware, requireFamilyRole('family_space_id', anyRole), getHistory);
router.post('/', authMiddleware, requireFamilyRole('family_space_id', ['owner', 'admin', 'branch admin']), createHistoryChapter);
router.get('/migrations', authMiddleware, requireFamilyRole('family_space_id', anyRole), getMigrationHistory);
router.get('/migrations/:id', authMiddleware, getMigrationRouteDetails); // Note: :id route doesn't have family_space_id in params/query naturally, leaving as authMiddleware only for now.

export default router;
