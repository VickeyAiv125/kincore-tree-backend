import express from 'express';
import {
    createFamilySpace,
    listFamilySpaces,
    getFamilySpace,
    updateFamilySpace,
    getMembers,
    inviteMember,
    getInvite,
    getJoinInfo,
    joinFamilyPublic,
    deleteFamilySpace,
    joinViaLink,
    findYourself,
    getFamilyDashboard,
    resolveJoinRequest,
    getFamilyEvents,
    getEventById,
    updateMemberRole,
    getFamilyRolePolicy,
    getMemberById,
    updateMember,
    addMember,
    updateRelationships,
    createEvent,
    getCustomLabels,
    updateCustomLabels,
    getReportData,
    getFamilyMigrationMap,
    getFamilySubscription,
    updateFamilySubscription,
    exportFamilySpaceData,
    getGovernanceLockStatus,
    requestGovernanceLock,
    transferOwnership,
    updateEventById,
    deleteEventById,
    getFamilyPrivacy,
    updateFamilyPrivacy,
    getFamilyPlatformConfig,
    updateFamilyPlatformConfig
} from '../controllers/familyController.js';
import {
    getPendingListings,
    approveListing,
    rejectListing,
    createListing,
    updateListing,
    deleteListing
} from '../controllers/familyMarketplaceController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireFamilyRole } from '../../middleware/rbacMiddleware.js';
import { requireGovernanceUnlocked } from '../../middleware/governanceMiddleware.js';
import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

// ── Static routes MUST come before /:id routes ──
// POST create family space (multipart: name, description, file=photo)
router.post('/', authMiddleware, upload.single('photo'), createFamilySpace);
router.get('/', authMiddleware, listFamilySpaces);

// Static named routes (before /:id to avoid "find-yourself" being treated as UUID)
router.get('/join-info', getJoinInfo);
router.post('/join', joinFamilyPublic);
router.post('/join-link', authMiddleware, joinViaLink);
router.get('/find-yourself', authMiddleware, findYourself);
router.get('/members/single/:id', authMiddleware, getMemberById);
router.post('/members', authMiddleware, upload.single('avatar'), addMember);
router.post('/members/relationships', authMiddleware, updateRelationships);
router.patch('/members/:id', authMiddleware, upload.single('avatar'), updateMember);

// Dynamic /:id routes
router.get('/:id', authMiddleware, getFamilySpace);
// Subscription & Storage
router.get('/:id/subscription', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), getFamilySubscription);
router.put('/:id/subscription', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), updateFamilySubscription);
router.get('/:id/export', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), requireGovernanceUnlocked('id'), exportFamilySpaceData);
router.get('/:id/governance-lock', authMiddleware, getGovernanceLockStatus);
router.post('/:id/governance-lock', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), requestGovernanceLock);
router.post('/:id/transfer-ownership', authMiddleware, requireFamilyRole('id', ['owner']), requireGovernanceUnlocked('id'), transferOwnership);

// Marketplace (Family Admin)
router.get('/:id/marketplace/pending', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), getPendingListings);
router.patch('/:id/marketplace/:listingId/approve', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), approveListing);
router.patch('/:id/marketplace/:listingId/reject', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), rejectListing);
router.post('/:id/marketplace', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), upload.array('images', 10), createListing);
router.patch('/:id/marketplace/:listingId', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), upload.array('images', 10), updateListing);
router.delete('/:id/marketplace/:listingId', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), deleteListing);

// 3. Update Existing Space
router.put('/:id', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), upload.single('photo'), updateFamilySpace);
router.delete('/:id', authMiddleware, requireFamilyRole('id', ['owner']), requireGovernanceUnlocked('id'), deleteFamilySpace);
router.get('/:id/members', authMiddleware, getMembers);
router.get('/:id/members/single/:memberId', authMiddleware, getMemberById);
router.patch('/:id/members/:memberId', authMiddleware, upload.single('avatar'), updateMember);
// Governance: Owner + Family Admin (finer rules enforced inside controller)
router.patch('/:id/members/:userId/role', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin', 'co-admin']), updateMemberRole);
router.get('/:id/role-policy', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin', 'co-admin', 'branch-admin', 'editor', 'member']), getFamilyRolePolicy);
router.get('/:id/dashboard', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), getFamilyDashboard);
router.get('/:id/privacy', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), getFamilyPrivacy);
router.put('/:id/privacy', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), updateFamilyPrivacy);
router.get('/:id/platform-config', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), getFamilyPlatformConfig);
router.put('/:id/platform-config', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), updateFamilyPlatformConfig);
router.get('/:id/invite', authMiddleware, requireFamilyRole('id', ['owner', 'admin', 'family-admin']), getInvite);
router.post('/:id/invite', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), inviteMember);

// Custom Labels
router.get('/:id/custom-labels', authMiddleware, getCustomLabels);
router.post('/:id/custom-labels', authMiddleware, requireFamilyRole('id', ['owner']), updateCustomLabels);

// Operations (Owner & Admin)
router.patch('/:id/members/:userId/resolve', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), resolveJoinRequest);
router.get('/:id/events', authMiddleware, getFamilyEvents);
router.get('/events/:eventId', authMiddleware, getEventById);
router.post('/:id/events', authMiddleware, upload.fields([{ name: 'cover_photo', maxCount: 1 }, { name: 'cover_image', maxCount: 1 }]), (req, res, next) => {
    req.file = req.files?.cover_photo?.[0] || req.files?.cover_image?.[0] || req.file;
    next();
}, createEvent);
router.put('/events/:eventId', authMiddleware, upload.single('cover_image'), updateEventById);
router.delete('/events/:eventId', authMiddleware, deleteEventById);

// Reports
router.get('/:id/reports', authMiddleware, requireFamilyRole('id', ['owner', 'admin']), getReportData);

// Migration Map public/member route for mobile app/webview
router.get('/:id/migration-map', authMiddleware, getFamilyMigrationMap);

export default router;
