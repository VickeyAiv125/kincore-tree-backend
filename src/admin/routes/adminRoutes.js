import express from 'express';
import {
    getDashboardOverview,
    getAuditLogs,
    getModerationQueue,
    resolveModeration,
    updateUserRole,
    updateUserStatus,
    getUsers,
    getUserById,
    getGlobalTrees,
    getGlobalPersons,
    getGlobalMedia,
    getGlobalMarketplace,
    getKccLedger,
    adminAddPerson,
    getPendingClaims,
    resolveClaim,
    getMigrationMap
} from '../controllers/adminController.js';
import * as eventAdmin from '../controllers/eventController.js';
import {
    getRevenueStats,
    getSubscriptions,
    getMarketplacePurchases,
    updateSubscription,
    getFamilySpacesRisk,
    adminCreateFamilySpace,
    getFamilySpaceRequests,
    resolveFamilySpaceRequest,
    suspendFamilySpace,
    reinstateFamilySpace,
    processRefund,
    rejectRefund,
    getAdminAlerts,
    grantCredits,
    getBusinessDashboard,
    getSubscriptionPlans,
    upsertSubscriptionPlan,
    getBillingInvoices,
    getBillingConfig,
    updateBillingConfig,
    getPlanEntitlements,
    getMarketplaceQueue,
    moderateListing,
    updateGlobalListing,
    deleteGlobalListing,
    getBusinessNotifications,
    markBusinessNotificationRead,
    markAllBusinessNotificationsRead,
    getMallMerchants,
    getMallMerchantStats,
    approveMallMerchant,
    rejectMallMerchant,
    getMallDisputes,
    getMallDisputeDetails,
    arbitrateMallDispute,
    getMallPayoutStats,
    getGovernanceLedger,
    executeGovernanceWalletControl
} from '../controllers/businessController.js';
import {
    getIncidents,
    createIncident,
    resolveIncident,
    updateIncident,
    getSystemConfigs,
    bulkUpdateConfigs,
    getConfigHistory,
    getBackgroundJobs,
    triggerJob,
    updateAlertChannels,
    getAlertChannels,
    getSystemMetrics,
    getApiKeys,
    createApiKey,
    deleteApiKey,
    exportPlatformData,
    searchUserForPurge,
    purgeUser,
    getWorkers,
    triggerWorkerAction,
    getDevOpsNotifications,
    pauseJob,
    retryJob,
    killJob,
    bulkJobAction,
    updateSchedule,
    publishBanner,
    assignOwner,
    getLatestBackup, exportPdf,
    getIncidentOwnerConfig,
    publishIncidentNote,
    getDeployStatus,
    recordDeployRevision,
    rollbackDeploy,
    updateDeployEnvironment
} from '../controllers/devopsController.js';
import { getSystemLogs, exportSystemLogs } from '../controllers/logsController.js';
import {
    getAbuseReports,
    moderateAbuseReport,
    getGlobalAuditLogs,
    getSystemComplianceReport,
    exportAuditLogs,
    getAuditorNotifications,
    getComplianceScores,
    getPlatformBilling
} from '../controllers/auditorController.js';
import {
    getCouncilApprovals,
    resolveCouncilRequest,
    getCouncilDashboard,
    getAssignedFamilies,
    getLineageClaims,
    getSensitiveChanges,
    resolveSensitiveChange,
    getMergeRequests,
    resolveMergeRequest,
    getCouncilAuditLogs,
    getCouncilBranches,
    getCouncilPrivacy,
    updateCouncilPrivacy
    , getGovernanceCases, createGovernanceCase, voteGovernanceCase, getDisputes, resolveDispute, getVotingConfigs, saveVotingConfig
} from '../controllers/councilController.js';
import {
    getTickets,
    getTicketDetails,
    replyToTicket,
    getSupportKnowledge,
    updateSupportKnowledge
} from '../controllers/supportController.js';
import {
    getAdmins,
    getAdminAudit,
    removeAdmin
} from '../controllers/hrController.js';
import {
    getAnnouncements,
    createAnnouncement,
    deleteAnnouncement
} from '../controllers/contentController.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { requirePlatformRole } from '../../middleware/rbacMiddleware.js';
import { upload } from '../../shared/controllers/mediaController.js';

const router = express.Router();

// 1. Dashboard & Quick Actions
router.get('/dashboard/overview', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'council', 'auditor', 'devops', 'business', 'support', 'hr', 'content']), getDashboardOverview);
router.get('/claims/pending', authMiddleware, requirePlatformRole(['super_admin', 'council', 'owner']), getPendingClaims);
router.patch('/claims/:id/resolve', authMiddleware, requirePlatformRole(['super_admin', 'council', 'owner']), resolveClaim);

// 1.1 Council Governance
router.get('/council/dashboard', authMiddleware, requirePlatformRole(['super_admin', 'council']), getCouncilDashboard);
router.get('/council/approvals', authMiddleware, requirePlatformRole(['super_admin', 'council']), getCouncilApprovals);
router.post('/council/resolve', authMiddleware, requirePlatformRole(['super_admin', 'council']), resolveCouncilRequest);
router.get('/council/assigned-families', authMiddleware, requirePlatformRole(['super_admin', 'council']), getAssignedFamilies);
router.get('/council/branches', authMiddleware, requirePlatformRole(['super_admin', 'council']), getCouncilBranches);
router.get('/council/lineage-claims', authMiddleware, requirePlatformRole(['super_admin', 'council']), getLineageClaims);
router.get('/council/sensitive-changes', authMiddleware, requirePlatformRole(['super_admin', 'council']), getSensitiveChanges);
router.post('/council/sensitive-changes/:id/resolve', authMiddleware, requirePlatformRole(['super_admin', 'council']), resolveSensitiveChange);
router.post('/council/sensitive-changes/:id/action', authMiddleware, requirePlatformRole(['super_admin', 'council']), resolveSensitiveChange);
router.get('/council/merge-requests', authMiddleware, requirePlatformRole(['super_admin', 'council']), getMergeRequests);
router.post('/council/merge-requests/:id/resolve', authMiddleware, requirePlatformRole(['super_admin', 'council']), resolveMergeRequest);
router.get('/council/audit-logs', authMiddleware, requirePlatformRole(['super_admin', 'council']), getCouncilAuditLogs);
router.get('/council/privacy', authMiddleware, requirePlatformRole(['super_admin', 'council']), getCouncilPrivacy);
router.put('/council/privacy', authMiddleware, requirePlatformRole(['super_admin', 'council']), updateCouncilPrivacy);
router.get('/council/governance-cases', authMiddleware, requirePlatformRole(['super_admin', 'council']), getGovernanceCases);
router.post('/council/governance-cases', authMiddleware, requirePlatformRole(['super_admin', 'council']), createGovernanceCase);
router.post('/council/governance-cases/:id/vote', authMiddleware, requirePlatformRole(['super_admin', 'council']), voteGovernanceCase);
router.get('/council/disputes', authMiddleware, requirePlatformRole(['super_admin', 'council']), getDisputes);
router.post('/council/disputes/:id/resolve', authMiddleware, requirePlatformRole(['super_admin', 'council']), resolveDispute);
router.get('/council/voting-configs', authMiddleware, requirePlatformRole(['super_admin', 'council']), getVotingConfigs);
router.post('/council/voting-configs', authMiddleware, requirePlatformRole(['super_admin', 'council']), saveVotingConfig);

// 2. Lineage Registry & Migration Map
router.get('/lineage/trees', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'council']), getGlobalTrees);
router.get('/lineage/persons', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'council']), getGlobalPersons);
router.post('/lineage/persons', authMiddleware, requirePlatformRole(['super_admin', 'owner']), adminAddPerson);
router.get('/lineage/migration-map', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'council']), getMigrationMap);

// 3. User & Governance
router.get('/users', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getUsers);
router.get('/users/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner']), getUserById);
router.patch('/users/:id/role', authMiddleware, requirePlatformRole(['owner']), updateUserRole);
router.patch('/users/:id/status', authMiddleware, requirePlatformRole(['owner', 'council', 'business']), updateUserStatus);

// 4. Content Moderation
router.get('/moderation/queue', authMiddleware, requirePlatformRole(['super_admin', 'council']), getModerationQueue);
router.post('/moderation/resolve', authMiddleware, requirePlatformRole(['super_admin', 'council']), resolveModeration);

// 5. Events & Engagement
router.get('/engagement/events', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'content']), eventAdmin.getGlobalEvents);
router.get('/engagement/events/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'content']), eventAdmin.getAdminEventById);
router.post('/engagement/events', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'content']), upload.single('cover_image'), eventAdmin.adminCreateEvent);
router.put('/engagement/events/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'content']), upload.single('cover_image'), eventAdmin.adminUpdateEvent);
router.delete('/engagement/events/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner']), eventAdmin.adminDeleteEvent);

// 6. Mall (Marketplace)
router.get('/mall/listings', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getGlobalMarketplace);
router.get('/mall/queue', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getMarketplaceQueue);
router.patch('/mall/listings/:id/moderate', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), moderateListing);
router.patch('/mall/listings/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), upload.array('images', 10), updateGlobalListing);
router.delete('/mall/listings/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), deleteGlobalListing);

// 6.1 PlenorHub / Mall Operations (Pending Merchants, Disputes, Payouts)
router.get('/mall/merchants', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getMallMerchants);
router.get('/mall/merchants/stats', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getMallMerchantStats);
router.post('/mall/merchants/:id/approve', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), approveMallMerchant);
router.post('/mall/merchants/:id/reject', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), rejectMallMerchant);
router.get('/mall/disputes', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getMallDisputes);
router.get('/mall/disputes/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getMallDisputeDetails);
router.post('/mall/disputes/:id/arbitrate', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), arbitrateMallDispute);
router.get('/mall/payouts/stats', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getMallPayoutStats);

// 6.2 BigK Coin Governance (Global Ledger & Wallet Controls)
router.get('/governance/ledger', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getGovernanceLedger);
router.post('/governance/wallets/control', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), executeGovernanceWalletControl);

// 7. Media Repository
router.get('/repository/media', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'auditor']), getGlobalMedia);

// 8. Subscription Management & Business Dashboard
router.get('/business/dashboard', authMiddleware, requirePlatformRole(['super_admin', 'business']), getBusinessDashboard);
router.get('/business/revenue', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getRevenueStats);
router.get('/business/subscriptions', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getSubscriptions);
router.get('/business/marketplace-purchases', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getMarketplacePurchases);
router.get('/business/billing/invoices', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getBillingInvoices);
router.get('/business/billing/config', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getBillingConfig);
router.patch('/business/billing/config', authMiddleware, requirePlatformRole(['super_admin', 'business']), updateBillingConfig);
router.patch('/business/subscriptions/:id', authMiddleware, requirePlatformRole(['super_admin', 'business']), updateSubscription);
router.get('/business/plans', authMiddleware, requirePlatformRole(['super_admin', 'business']), getSubscriptionPlans);
router.post('/business/plans', authMiddleware, requirePlatformRole(['super_admin', 'business']), upsertSubscriptionPlan);
router.get('/business/plans/entitlements/:familySpaceId', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getPlanEntitlements);
router.get('/business/risk-assessment', authMiddleware, requirePlatformRole(['super_admin', 'business']), getFamilySpacesRisk);
router.post('/business/spaces', authMiddleware, requirePlatformRole(['super_admin', 'business']), adminCreateFamilySpace);
router.get('/business/spaces/requests', authMiddleware, requirePlatformRole(['super_admin', 'business']), getFamilySpaceRequests);
router.patch('/business/spaces/requests/:id', authMiddleware, requirePlatformRole(['super_admin', 'business']), resolveFamilySpaceRequest);
router.post('/business/spaces/:id/suspend', authMiddleware, requirePlatformRole(['super_admin', 'business']), suspendFamilySpace);
router.post('/business/spaces/:id/reinstate', authMiddleware, requirePlatformRole(['super_admin', 'business']), reinstateFamilySpace);
router.post('/business/billing/refund', authMiddleware, requirePlatformRole(['super_admin', 'business']), processRefund);
router.post('/business/billing/refund/reject', authMiddleware, requirePlatformRole(['super_admin', 'business']), rejectRefund);
router.post('/business/spaces/:id/credits', authMiddleware, requirePlatformRole(['super_admin', 'business']), grantCredits);
router.get('/dashboard/alerts', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business', 'devops', 'council']), getAdminAlerts);

// 9. KCC Coin Ledger
router.get('/ledger/flow', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'business']), getKccLedger);

// 10. DevOps & Support
router.get('/devops/notifications', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'devops']), getDevOpsNotifications);
router.get('/devops/incidents', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'devops']), getIncidents);
router.post('/devops/incidents', authMiddleware, requirePlatformRole(['super_admin', 'devops']), createIncident);
router.patch('/devops/incidents/:id/resolve', authMiddleware, requirePlatformRole(['super_admin', 'devops']), resolveIncident);
router.patch('/devops/incidents/:id', authMiddleware, requirePlatformRole(['super_admin', 'devops']), updateIncident);
router.get('/devops/configs', authMiddleware, requirePlatformRole(['super_admin', 'business', 'devops']), getSystemConfigs);
router.get('/devops/configs/history', authMiddleware, requirePlatformRole(['super_admin', 'business', 'devops']), getConfigHistory);
router.patch('/devops/configs/bulk', authMiddleware, requirePlatformRole(['super_admin', 'business', 'devops']), bulkUpdateConfigs);

// API Key Lifecycle
router.get('/devops/api-keys', authMiddleware, requirePlatformRole(['super_admin', 'business', 'devops']), getApiKeys);
router.post('/devops/api-keys', authMiddleware, requirePlatformRole(['super_admin', 'business']), createApiKey);
router.delete('/devops/api-keys/:id', authMiddleware, requirePlatformRole(['super_admin', 'business']), deleteApiKey);

// Infrastructure & Monitoring
router.get('/devops/metrics', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'devops', 'business']), getSystemMetrics);
router.get('/devops/jobs', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), getBackgroundJobs);
router.get('/devops/backups/latest', authMiddleware, requirePlatformRole(['super_admin', 'business', 'devops']), getLatestBackup);
router.post('/devops/jobs/bulk', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), bulkJobAction);
router.post('/devops/jobs/:id/trigger', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), triggerJob);
router.post('/devops/jobs/:id/pause', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), pauseJob);
router.post('/devops/jobs/:id/retry', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), retryJob);
router.post('/devops/jobs/:id/kill', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), killJob);
router.post('/devops/jobs/:id/schedule', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), updateSchedule);
router.get('/devops/workers', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), getWorkers);
router.post('/devops/workers/:id/trigger', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), triggerWorkerAction);
router.get('/devops/export', authMiddleware, requirePlatformRole(['super_admin', 'business']), exportPlatformData);
router.post('/devops/export-pdf', authMiddleware, exportPdf);
router.get('/devops/compliance/search', authMiddleware, requirePlatformRole(['super_admin', 'business']), searchUserForPurge);
router.delete('/devops/compliance/purge/:userId', authMiddleware, requirePlatformRole(['super_admin', 'business']), purgeUser);
router.post('/devops/incidents/publish-banner', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), publishBanner);
router.post('/devops/incidents/assign-owner', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business']), assignOwner);
router.post('/devops/incidents/note', authMiddleware, requirePlatformRole(['super_admin', 'devops', 'business', 'auditor']), publishIncidentNote);
router.get('/devops/incidents/owner-config', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'devops', 'business', 'auditor']), getIncidentOwnerConfig);

router.get('/devops/deploy-status', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'devops']), getDeployStatus);
router.post('/devops/deploy', authMiddleware, requirePlatformRole(['super_admin', 'devops']), recordDeployRevision);
router.post('/devops/deploy/rollback', authMiddleware, requirePlatformRole(['super_admin', 'devops']), rollbackDeploy);
router.patch('/devops/deploy/environments/:env', authMiddleware, requirePlatformRole(['super_admin', 'devops']), updateDeployEnvironment);
router.get('/devops/alerts/channels', authMiddleware, requirePlatformRole(['super_admin', 'devops']), getAlertChannels);
router.post('/devops/alerts/channels', authMiddleware, requirePlatformRole(['super_admin', 'devops']), updateAlertChannels);

// System Logs
router.get('/devops/logs', authMiddleware, requirePlatformRole(['super_admin', 'devops']), getSystemLogs);
router.post('/devops/logs/export', authMiddleware, requirePlatformRole(['super_admin', 'devops']), exportSystemLogs);

router.get('/support/knowledge', authMiddleware, getSupportKnowledge);
router.patch('/support/knowledge', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'support', 'business', 'content']), updateSupportKnowledge);
router.get('/support/tickets', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'support', 'business']), getTickets);
router.get('/support/tickets/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'support', 'business']), getTicketDetails);
router.post('/support/tickets/:id/reply', authMiddleware, requirePlatformRole(['super_admin', 'support', 'business']), replyToTicket);

// 11. HR & Marketing Announcements
router.get('/hr/admins', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'hr']), getAdmins);
router.get('/hr/admins/:admin_id/audit', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'hr']), getAdminAudit);
router.delete('/hr/admins/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner']), removeAdmin);

router.get('/content/announcements', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'content']), getAnnouncements);
router.post('/content/announcements', authMiddleware, requirePlatformRole(['super_admin', 'content']), createAnnouncement);
router.delete('/content/announcements/:id', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'content']), deleteAnnouncement);

// 12. Security Audit Logs & Trust & Safety
router.get('/safety/reports', authMiddleware, requirePlatformRole(['super_admin', 'auditor', 'business']), getAbuseReports);
router.patch('/safety/reports/:id/moderate', authMiddleware, requirePlatformRole(['super_admin', 'auditor', 'business']), moderateAbuseReport);
router.get('/audit-logs', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'auditor', 'devops']), getAuditLogs);
router.get('/audit-logs/global', authMiddleware, requirePlatformRole(['super_admin', 'auditor']), getGlobalAuditLogs);
router.get('/business/audit-logs', authMiddleware, requirePlatformRole(['super_admin', 'business', 'auditor']), getGlobalAuditLogs);
router.get('/audit-logs/export', authMiddleware, requirePlatformRole(['super_admin']), exportAuditLogs);
router.get('/compliance/report', authMiddleware, requirePlatformRole(['super_admin', 'auditor']), getSystemComplianceReport);

// Business Admin Notifications
router.get('/business/notifications', authMiddleware, requirePlatformRole(['super_admin', 'business']), getBusinessNotifications);
router.patch('/business/notifications/mark-all-read', authMiddleware, requirePlatformRole(['super_admin', 'business']), markAllBusinessNotificationsRead);
router.patch('/business/notifications/:id/read', authMiddleware, requirePlatformRole(['super_admin', 'business']), markBusinessNotificationRead);

// Auditor Admin Notifications
router.get('/auditor/notifications', authMiddleware, requirePlatformRole(['super_admin', 'owner', 'auditor']), getAuditorNotifications);

// Auditor Compliance Scores
router.get('/auditor/compliance/scores', authMiddleware, requirePlatformRole(['super_admin', 'auditor']), getComplianceScores);

// Auditor Platform Billing
router.get('/auditor/billing', authMiddleware, requirePlatformRole(['super_admin', 'auditor']), getPlatformBilling);

export default router;
