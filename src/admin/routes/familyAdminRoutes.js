import express from 'express';
import {
    createFamilyAdminReport,
    getFamilyAdminAuditLogs,
    getFamilyAdminClaims,
    getFamilyAdminDashboard,
    getFamilyAdminKccLedger,
    getFamilyAdminMedia,
    getFamilyAdminMigrationMap,
    createFamilyAdminMigrationPoint,
    updateFamilyAdminMigrationPoint,
    deleteFamilyAdminMigrationPoint,
    getFamilyAdminModeration,
    getFamilyAdminReports,
    getFamilyAdminRoles,
    getFamilyAdminSettings,
    getFamilyAdminPersons,
    getFamilyAdminBranches,
    resolveFamilyAdminClaim,
    resolveFamilyAdminModeration,
    updateFamilyAdminSettings,
    updateFamilyRoleSettings,
    uploadFamilyAdminMedia,
    updateFamilyAdminLogo,
    exportFamilyAdminData,
    deleteFamilyAdminMedia,
    tagMediaPerson,
    untagMediaPerson,
    getFamilyAdminEvents,
    linkMediaToEvent,
    initiateOwnershipTransfer,
    getFamilyAdminNotificationPolicies,
    updateFamilyAdminNotificationPolicies,
    testFamilyAdminNotificationPolicy,
    getFamilyAdminNotificationLogs,
    getFamilyAdminNotifications,
    markFamilyAdminNotificationRead,
    markAllFamilyAdminNotificationsRead,
    createSupportTicket,
    getFamilyAdminSupportKnowledge,
    listFamilyAdminSupportTickets,
    getFamilyAdminSupportTicket,
    replyFamilyAdminSupportTicket,
    uploadFamilyAdminSupportAttachment,
    getFamilyAdminBranchApprovals,
    resolveFamilyAdminBranchApproval
} from '../controllers/familyAdminController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requireGovernanceUnlocked } from '../../middleware/governanceMiddleware.js';
import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

router.use(authMiddleware);

router.get('/:familySpaceId/dashboard', getFamilyAdminDashboard);

router.get('/:familySpaceId/roles', getFamilyAdminRoles);
router.patch('/:familySpaceId/roles/settings', updateFamilyRoleSettings);
router.post('/:familySpaceId/governance/transfer-ownership', requireGovernanceUnlocked('familySpaceId'), initiateOwnershipTransfer);

router.get('/:familySpaceId/claims', getFamilyAdminClaims);
router.patch('/:familySpaceId/claims/:claimId', resolveFamilyAdminClaim);

router.get('/:familySpaceId/branch-approvals', getFamilyAdminBranchApprovals);
router.patch('/:familySpaceId/branch-approvals/:approvalId', resolveFamilyAdminBranchApproval);

router.get('/:familySpaceId/moderation', getFamilyAdminModeration);
router.patch('/:familySpaceId/moderation/:reportId', resolveFamilyAdminModeration);

router.get('/:familySpaceId/media', getFamilyAdminMedia);
router.post('/:familySpaceId/media', upload.single('file'), uploadFamilyAdminMedia);
router.delete('/:familySpaceId/media/:mediaId', deleteFamilyAdminMedia);
router.post('/:familySpaceId/media/:mediaId/tags', tagMediaPerson);
router.delete('/:familySpaceId/media/:mediaId/tags/:personId', untagMediaPerson);
router.post('/:familySpaceId/media/:mediaId/link-event', linkMediaToEvent);

router.get('/:familySpaceId/migration-map', getFamilyAdminMigrationMap);
router.post('/:familySpaceId/migration-map', createFamilyAdminMigrationPoint);
router.put('/:familySpaceId/migration-map/:pointId', updateFamilyAdminMigrationPoint);
router.delete('/:familySpaceId/migration-map/:pointId', deleteFamilyAdminMigrationPoint);
router.get('/:familySpaceId/kcc-ledger', getFamilyAdminKccLedger);
router.get('/:familySpaceId/persons', getFamilyAdminPersons);
router.get('/:familySpaceId/branches', getFamilyAdminBranches);

router.get('/:familySpaceId/reports', getFamilyAdminReports);
router.post('/:familySpaceId/reports', createFamilyAdminReport);

router.get('/:familySpaceId/settings', getFamilyAdminSettings);
router.patch('/:familySpaceId/settings', updateFamilyAdminSettings);
router.post('/:familySpaceId/settings/logo', upload.single('logo'), updateFamilyAdminLogo);
router.get('/:familySpaceId/settings/export', requireGovernanceUnlocked('familySpaceId'), exportFamilyAdminData);
router.get('/:familySpaceId/settings/notification-policies', getFamilyAdminNotificationPolicies);
router.patch('/:familySpaceId/settings/notification-policies', updateFamilyAdminNotificationPolicies);
router.post('/:familySpaceId/settings/notification-policies/test', testFamilyAdminNotificationPolicy);
router.get('/:familySpaceId/settings/notification-logs', getFamilyAdminNotificationLogs);

router.get('/:familySpaceId/events', getFamilyAdminEvents);
router.get('/:familySpaceId/audit-logs', getFamilyAdminAuditLogs);
router.get('/:familySpaceId/notifications', getFamilyAdminNotifications);
router.patch('/:familySpaceId/notifications/mark-all-read', markAllFamilyAdminNotificationsRead);
router.patch('/:familySpaceId/notifications/:notificationId/read', markFamilyAdminNotificationRead);
router.get('/:familySpaceId/support/knowledge', getFamilyAdminSupportKnowledge);
router.get('/:familySpaceId/support-tickets', listFamilyAdminSupportTickets);
router.get('/:familySpaceId/support-tickets/:ticketId', getFamilyAdminSupportTicket);
router.post('/:familySpaceId/support-tickets/:ticketId/reply', replyFamilyAdminSupportTicket);
router.post('/:familySpaceId/support-attachments', upload.single('file'), uploadFamilyAdminSupportAttachment);
router.post('/:familySpaceId/support-tickets', createSupportTicket);

export default router;
