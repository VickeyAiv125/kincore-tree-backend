import express from 'express';
import { addOutsideMemberToTree, discoverOutsideMembers, getAppMembers } from '../controllers/memberController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';

const router = express.Router();

router.get('/discover', authMiddleware, discoverOutsideMembers);
router.post('/add-to-tree', authMiddleware, addOutsideMemberToTree);
router.get('/', authMiddleware, getAppMembers);

export default router;
