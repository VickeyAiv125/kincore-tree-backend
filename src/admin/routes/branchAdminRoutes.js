import express from 'express';
import { 
    getBranchDashboardStats,
    getBranchMembers,
    getBranchMemberById,
    addBranchMember,
    updateBranchMember,
    deleteBranchMember,
    getBranchEvents,
    createBranchEvent,
    updateEventRSVP,
    getBranchApprovals,
    handleApprovalAction,
    searchPersons,
    uploadMemberPhoto,
    uploadEventPhoto
} from '../controllers/branchAdminController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

// Stats
router.get('/stats/:branchId', authMiddleware, getBranchDashboardStats);

// Members
router.get('/members/:branchId', authMiddleware, getBranchMembers);
router.get('/member/:memberId', authMiddleware, getBranchMemberById);
router.post('/members/:branchId', authMiddleware, addBranchMember);
router.patch('/members/update/:memberId', authMiddleware, updateBranchMember);
router.delete('/members/delete/:memberId', authMiddleware, deleteBranchMember);
router.get('/search', authMiddleware, searchPersons);

// Media (S3)
router.post('/upload-photo', authMiddleware, upload.single('photo'), uploadMemberPhoto);
router.post('/upload-event-photo', authMiddleware, upload.single('photo'), uploadEventPhoto);

// Events
router.get('/events/:branchId', authMiddleware, getBranchEvents);
router.post('/events/:branchId', authMiddleware, createBranchEvent);
router.post('/events/rsvp/:eventId', authMiddleware, updateEventRSVP);

// Approvals
router.get('/approvals/:branchId', authMiddleware, getBranchApprovals);
router.patch('/approvals/action/:approvalId', authMiddleware, handleApprovalAction);

export default router;
