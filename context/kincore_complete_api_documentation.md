# Kincore Complete Backend API Documentation (Exhaustive Reference)

**Version**: `v3.1.production`  
**Base URL**: `https://[YOUR_DOMAIN]/api`  
**Authentication Header**: `Authorization: Bearer [JWT_TOKEN]` (Required for all endpoints unless marked **Public**)  
**Content-Type**: `application/json` or `multipart/form-data` (for media/file uploads)

---

## 📑 Table of Contents
1. [Section 1: App Side APIs (Mobile Application Suite)](#section-1-app-side-apis-mobile-application-suite)
   - [1.1 Authentication & Identity](#11-authentication--identity)
   - [1.2 User Profile & Role Discovery](#12-user-profile--role-discovery)
   - [1.3 Family Spaces & Member Directory](#13-family-spaces--member-directory)
   - [1.4 Lineage Tree & Kinship Calculator](#14-lineage-tree--kinship-calculator)
   - [1.5 Social Feed, Stories & Memories](#15-social-feed-stories--memories)
   - [1.6 Events, Gift Exchange & Chat](#16-events-gift-exchange--chat)
   - [1.7 Marketplace, Orders & KCC Ledger](#17-marketplace-orders--kcc-ledger)
   - [1.8 Media Repository & File Uploads](#18-media-repository--file-uploads)
   - [1.9 Family History & Migration Routes](#19-family-history--migration-routes)
   - [1.10 Member Requests & Invitations](#110-member-requests--invitations)
   - [1.11 Public Lineage & Person Search](#111-public-lineage--person-search)
   - [1.12 Notifications, Privacy & App Settings](#112-notifications-privacy--app-settings)
2. [Section 2: Web Side APIs (Admin Panel Suite)](#section-2-web-side-apis-admin-panel-suite)
   - [2.1 Admin Authentication & Session](#21-admin-authentication--session)
   - [2.2 Global Dashboard & Executive Overview](#22-global-dashboard--executive-overview)
   - [2.3 Lineage Registry & Migration Mapping](#23-lineage-registry--migration-mapping)
   - [2.4 User Management & Claim Resolution](#24-user-management--claim-resolution)
   - [2.5 Content Moderation & Abuse Reporting](#25-content-moderation--abuse-reporting)
   - [2.6 Council Governance & Sensitive Lineage Approvals](#26-council-governance--sensitive-lineage-approvals)
   - [2.7 DevOps Infrastructure, Workers & System Logs](#27-devops-infrastructure-workers--system-logs)
   - [2.8 Business Revenue, Plans & Subscriptions](#28-business-revenue-plans--subscriptions)
   - [2.9 Mall (Marketplace) Admin & Engagement Events](#29-mall-marketplace-admin--engagement-events)
   - [2.10 HR Administration & Marketing Announcements](#210-hr-administration--marketing-announcements)
   - [2.11 Customer Support Ticket Management](#211-customer-support-ticket-management)
   - [2.12 Security Audit Logs & Compliance Reporting](#212-security-audit-logs--compliance-reporting)
   - [2.13 Family Admin & Branch Admin Portals](#213-family-admin--branch-admin-portals)
   - [2.14 Tree Merging & Governance Proposals](#214-tree-merging--governance-proposals)

---

# Section 1: App Side APIs (Mobile Application Suite)

This section contains literally every consumer-facing endpoint utilized by the React Native and Flutter mobile applications for member onboarding, genealogical exploration, messaging, and media sharing.

### 1.1 Authentication & Identity
* **`POST /api/auth/login`**: Standard email/password login returning JWT and session.
* **`POST /api/auth/oauth-login`**: Unified OAuth SSO (Google/Facebook). With `"client_type": "app"`, supports automatic profile creation for first-time signups.
* **`POST /api/auth/app/forgot-password`**: Requests a 6-digit OTP code sent via email (Option B validation enforced).
* **`POST /api/auth/app/reset-password`**: Verifies OTP code and sets new user password in-app.
* **`POST /api/auth/logout`**: Terminates session and invalidates tokens.
* **`GET /api/auth/session`**: Retrieves current authenticated session and permission flags.

### 1.2 User Profile & Role Discovery
* **`GET /api/users/me`**: Current user profile for the app header. Includes `level`, `level_title`, `level_label` (e.g. `"Level 4 Historian"`), `life_years` (e.g. `"1920-1995"` or `"1990-Present"`), `birth_year`, `death_year`, `spaces_count`, and `spaces`. Optional `?family_space_id=` (or `x-family-space-id` header) scopes the claimed person used for life years.
* **`PUT /api/users/me`**: Updates the current user's profile fields.
* **`GET /api/app/profile/my-role`**: Returns user's highest role hierarchy (`owner`, `admin`, `family-admin`, `member`) and space access for dynamic UI rendering.
* **`GET /api/users/profile`**: Fetches user's complete personal profile, avatar, phone, and biography.
* **`PUT /api/users/profile`**: Updates personal profile attributes.
* **`DELETE /api/users/account`**: Initiates GDPR permanent account deletion.

### 1.3 Family Spaces & Member Directory
* **`GET /api/app/spaces`**: Lists all family spaces the mobile user belongs to or administers.
* **`POST /api/app/spaces`**: Creates a new family space and assigns the creator as `family-admin`.
* **`GET /api/app/spaces/:id`**: Fetches detailed space metadata and cover imagery.
* **`GET /api/app/members`**: Lists active family members and staff within a family space.
* **`POST /api/app/members/invite`**: Sends email invitations or sharable links to prospective members.
* **`GET /api/families/:id/bio`**: Retrieves historical dynasty biography and heritage summary.

### 1.4 Lineage Tree & Kinship Calculator
* **`GET /api/clantree`** / **`GET /api/tree`**: Retrieves full graph JSON (`nodes`, `edges`) for tree visualization.
* **`GET /api/clantree/person/:id`**: Retrieves genealogical details, birth/death records, and immediate relatives for a node.
* **`POST /api/clantree/person`**: Adds a new person node (child, spouse, parent) to the graph.
* **`PUT /api/clantree/person/:id`**: Updates person attributes, living status, or notes.
* **`GET /api/app/calculator/relationship`**: Computes exact kinship relationship (e.g., "Second Cousin Once Removed") and connecting ancestor path between two nodes.

### 1.5 Social Feed, Stories & Memories
* **`GET /api/posts`**: Retrieves paginated family news feed.
* **`POST /api/posts`**: Publishes a new feed post with media attachments and tagging.
* **`POST /api/posts/:id/like`**: Toggles like/heart reaction on a feed post.
* **`POST /api/posts/:id/comment`**: Submits a text comment on a feed post.
* **`GET /api/stories`**: Lists active 24-hour ephemeral family stories.
* **`POST /api/stories`**: Uploads a new photo/video 24-hour story.
* **`GET /api/memories`**: Retrieves archival family memories and "On This Day" flashbacks.
* **`POST /api/memories`**: Preserves a timeless memory or historical heirloom in the vault.
* **`GET /api/albums`**: Lists themed media albums in the family space.
* **`POST /api/albums`**: Creates a new collaborative media album.

### 1.6 Events, Gift Exchange & Chat
* **`GET /api/events`**: Lists upcoming reunions, birthdays, and anniversaries.
* **`POST /api/events`**: Schedules a new family event with RSVP tracking.
* **`POST /api/events/:id/rsvp`**: Updates user attendance status (`going`, `maybe`, `declined`).
* **`GET /api/events/:id/gift-exchange`**: Retrieves Secret Santa gift exchange pairings and wishlists.
* **`POST /api/events/:id/gift-exchange/draw`**: Executes randomized Secret Santa pairing assignments.
* **`GET /api/chat/channels`**: Lists active family group chats and direct messaging channels.
* **`GET /api/chat/messages/:channelId`**: Retrieves paginated chat message history.
* **`POST /api/chat/messages/:channelId`**: Sends a text, voice, or media message to a chat channel.

### 1.7 Marketplace, Orders & KCC Ledger
* **`GET /api/marketplace/items`**: Lists available merchandise, tree posters, and DNA kits.
* **`POST /api/orders`**: Places a new e-commerce order for physical printings or digital downloads.
* **`GET /api/orders/my-orders`**: Retrieves user order history, shipping status, and receipts.
* **`GET /api/ledger/balance`**: Retrieves user Kincore Coin (KCC) rewards balance.
* **`GET /api/ledger/transactions`**: Lists debit/credit transactions for platform rewards.

### 1.8 Media Repository & File Uploads
* **`GET /api/media`**: Retrieves all media items for a family space (`?family_space_id=UUID&type=image`).
* **`POST /api/media/upload`**: Uploads general photo/video media file via `multipart/form-data`.
* **`POST /api/media/upload/avatar`**: Uploads user or person avatar image.
* **`DELETE /api/media/:id`**: Permanently deletes a media record and storage file.

### 1.9 Family History & Migration Routes
* **`GET /api/app/history`**: Retrieves historical family timeline chapters and dynasty milestones.
* **`POST /api/app/history`**: Creates a new historical chapter or timeline entry.
* **`GET /api/app/history/migrations`**: Retrieves historical migration routes and travel paths.
* **`GET /api/app/history/migrations/:id`**: Retrieves detailed geocoded waypoints for a specific migration path.

### 1.10 Member Requests & Invitations
* **`GET /api/app/requests`**: Retrieves pending join requests and space membership invitations.

### 1.11 Public Lineage & Person Search
* **`GET /api/public/persons/search`**: Public search endpoint for historical figures and unindexed persons.
* **`GET /api/public/persons/:id`**: Retrieves public biographical preview for a genealogical node.

### 1.12 Notifications, Privacy & App Settings
* **`GET /api/notifications`**: Retrieves unread push alerts, RSVP reminders, and tree notices.
* **`PATCH /api/notifications/:id/read`**: Marks notification(s) as read.
* **`GET /api/app/privacy`**: Retrieves mobile privacy settings (tree indexing, search visibility).
* **`PUT /api/app/privacy`**: Updates privacy toggles and data sharing permissions.
* **`GET /api/settings`**: Retrieves application theme (`dark`/`light`) and language preferences.
* **`PUT /api/settings`**: Updates user application settings and push notification toggles.

---

# Section 2: Web Side APIs (Admin Panel Suite)

This section documents literally every administrative endpoint mounted in the Kincore backend for the Web Admin Panel. These APIs require elevated RBAC roles (`owner`, `admin`, `super_admin`, `family-admin`, `branch-admin`, `council`, `auditor`, `devops`, `business`, `support`, `hr`, `content`).

### 2.1 Admin Authentication & Session
* **`POST /api/auth/login`**: Authenticates admin user with email/password and returns admin JWT.
* **`POST /api/auth/oauth-login`**: Unified OAuth SSO with `"client_type": "web"`. Enforces **Login-Only Access**, rejecting unauthorized accounts lacking pre-existing admin privileges.

### 2.2 Global Dashboard & Executive Overview
* **`GET /api/admin/dashboard/overview`**: Retrieves global KPIs (total members, active claims, trees planted, storage used, KCC balance).
* **`GET /api/admin/dashboard/performance`**: Retrieves analytical charts (user growth, MAU, claim resolution speed).
* **`GET /api/admin/dashboard/activity-feed`**: Retrieves real-time global administrative activity stream.
* **`GET /api/admin/dashboard/alerts`**: Retrieves active system warnings and business notifications.

### 2.3 Lineage Registry & Migration Mapping
* **`GET /api/admin/lineage/trees`**: Lists all clan trees across the platform with node counts and statuses.
* **`GET /api/admin/lineage/persons`**: Global search across all person records in the Kincore database.
* **`POST /api/admin/lineage/persons`**: Administrative override to inject historical person nodes directly into any tree.
* **`PUT /api/admin/lineage/persons/:id`**: Modifies person attributes or administratively locks verified nodes.
* **`DELETE /api/admin/lineage/persons/:id`**: Permanently purges erroneous or duplicate person records.
* **`GET /api/admin/lineage/migration-map`**: Retrieves geocoded coordinates (`lat`/`lng`) of historical family migrations.

### 2.4 User Management & Claim Resolution
* **`GET /api/admin/users`**: Retrieves paginated directory of all platform users with filtering.
* **`GET /api/admin/users/:id`**: Retrieves comprehensive account audit details for a specific user.
* **`PATCH /api/admin/users/:id/role`**: Elevates or demotes user administrative privileges (`member`, `staff`, `admin`, `owner`).
* **`PATCH /api/admin/users/:id/status`**: Suspends, bans, or reactivates user accounts.
* **`GET /api/admin/claims/pending`** / **`GET /api/claims/pending`**: Lists pending membership claims and identity verifications.
* **`PATCH /api/admin/claims/:id/resolve`** / **`PATCH /api/claims/:id/resolve`**: Approves or rejects a membership claim (`{"action": "approved" | "rejected"}`).

### 2.5 Content Moderation & Abuse Reporting
* **`GET /api/admin/moderation/queue`**: Lists flagged feed posts, comments, and photo uploads awaiting moderation.
* **`POST /api/admin/moderation/resolve`**: Resolves moderation tickets by removing content or issuing warnings.
* **`GET /api/admin/safety/reports`** / **`GET /api/reports/moderation/queue`**: Retrieves user-reported abuse and harassment cases.
* **`PATCH /api/admin/safety/reports/:id/moderate`** / **`PATCH /api/reports/:id/moderate`**: Resolves abuse tickets with takedown actions or dismissals.

### 2.6 Council Governance & Sensitive Lineage Approvals
* **`GET /api/admin/council/dashboard`**: Retrieves clan council governance metrics and proposal statuses.
* **`GET /api/admin/council/approvals`**: Lists pending council approval requests for dynasty charters.
* **`POST /api/admin/council/resolve`**: Casts official council resolutions on administrative requests.
* **`GET /api/admin/council/assigned-families`**: Lists family dynasties assigned to council members for oversight.
* **`GET /api/admin/council/branches`**: Lists regional branches under council supervision.
* **`GET /api/admin/council/lineage-claims`**: Lists disputed genealogical lineage claims before the council.
* **`GET /api/admin/council/sensitive-changes`**: Lists attempted edits to historical or locked person nodes.
* **`POST /api/admin/council/sensitive-changes/:id/resolve`**: Approves or rejects sensitive lineage modifications.
* **`POST /api/admin/council/sensitive-changes/:id/action`**: Executes enforcement actions on sensitive tree changes.
* **`GET /api/admin/council/merge-requests`**: Lists pending tree merge requests awaiting council review.
* **`POST /api/admin/council/merge-requests/:id/resolve`**: Approves or rejects tree merging operations.
* **`GET /api/admin/council/audit-logs`**: Retrieves governance audit logs for council voting and decisions.
* **`GET /api/admin/council/privacy`**: Retrieves council-level privacy and disclosure policies.
* **`PUT /api/admin/council/privacy`**: Updates council privacy rules and data access thresholds.

### 2.7 DevOps Infrastructure, Workers & System Logs
* **`GET /api/admin/devops/incidents`**: Lists active server health alerts, API latency anomalies, and job failures.
* **`POST /api/admin/devops/incidents`**: Manually logs a system incident or maintenance notice.
* **`PATCH /api/admin/devops/incidents/:id`**: Updates incident status and severity.
* **`PATCH /api/admin/devops/incidents/:id/resolve`**: Marks a system incident as resolved.
* **`POST /api/admin/devops/incidents/publish-banner`**: Publishes a platform-wide maintenance banner to frontend users.
* **`POST /api/admin/devops/incidents/assign-owner`**: Assigns an engineering owner to investigate an incident.
* **`POST /api/admin/devops/incidents/note`**: Appends technical investigation notes to an incident ticket.
* **`GET /api/admin/devops/incidents/owner-config`**: Retrieves incident escalation rules and engineer routing configs.
* **`GET /api/admin/devops/configs`**: Retrieves global system configuration variables and environment parameters.
* **`GET /api/admin/devops/configs/history`**: Retrieves audit trail of system configuration modifications.
* **`PATCH /api/admin/devops/configs/bulk`**: Executes bulk updates on system environment configurations.
* **`GET /api/admin/devops/api-keys`**: Lists active API keys for external service integrations.
* **`POST /api/admin/devops/api-keys`**: Generates a new scoped API key for third-party consumers.
* **`DELETE /api/admin/devops/api-keys/:id`**: Revokes an API key immediately.
* **`GET /api/admin/devops/metrics`**: Retrieves real-time CPU, memory, database connection, and request throughput metrics.
* **`GET /api/admin/devops/jobs`**: Lists status of asynchronous background cron jobs and queues.
* **`POST /api/admin/devops/jobs/:id/trigger`**: Manually triggers execution of a background cron job.
* **`POST /api/admin/devops/jobs/:id/pause`**: Pauses an active background job queue.
* **`POST /api/admin/devops/jobs/:id/retry`**: Retries a failed background job.
* **`POST /api/admin/devops/jobs/:id/schedule`**: Modifies the cron schedule expression for a background task.
* **`GET /api/admin/devops/workers`**: Lists active background worker instances and heartbeat timestamps.
* **`POST /api/admin/devops/workers/:id/trigger`**: Triggers maintenance actions or restarts on a worker instance.
* **`GET /api/admin/devops/backups/latest`**: Retrieves metadata and verification status of the latest database backup.
* **`GET /api/admin/devops/export`**: Initiates bulk platform data export for archival backup.
* **`POST /api/admin/devops/export-pdf`**: Generates formatted PDF administrative reports.
* **`GET /api/admin/devops/compliance/search`**: Searches user accounts for GDPR data scrubbing compliance.
* **`DELETE /api/admin/devops/compliance/purge/:userId`**: Executes irreversible GDPR data purge on a user account.
* **`POST /api/admin/devops/alerts/channels`**: Configures Slack/email alert notification channels for DevOps incidents.
* **`GET /api/admin/devops/logs`**: Retrievesraw server application and error logs.
* **`POST /api/admin/devops/logs/export`**: Exports server logs to downloadable archives.
* **`GET /api/admin/devops/notifications`**: Retrieves DevOps-specific system alerts and infrastructure notices.
* **`POST /api/admin/devops/telemetry/trigger`**: Triggers immediate telemetry aggregation crons.

### 2.8 Business Revenue, Plans & Subscriptions
* **`GET /api/admin/business/dashboard`**: Retrieves executive financial summary, churn rate, and MRR/ARR growth.
* **`GET /api/admin/business/revenue`**: Retrieves detailed cash flow reports and revenue breakdown by tier.
* **`GET /api/admin/business/subscriptions`**: Lists active family space subscriptions and billing cycles.
* **`PATCH /api/admin/business/subscriptions/:id`**: Upgrades, downgrades, or cancels an enterprise subscription.
* **`GET /api/admin/business/plans`**: Lists available subscription billing tiers (`Free`, `Starter`, `Dynasty`).
* **`POST /api/admin/business/plans`**: Creates or updates subscription plan pricing and feature quotas.
* **`GET /api/admin/business/marketplace-purchases`**: Retrieves global e-commerce purchase logs across all spaces.
* **`GET /api/admin/business/risk-assessment`**: Evaluates family spaces for financial fraud or storage abuse risk.
* **`POST /api/admin/business/spaces`**: Administrative creation of an enterprise family space.
* **`GET /api/admin/business/spaces/requests`**: Lists incoming requests for enterprise dynasty space creation.
* **`PATCH /api/admin/business/spaces/requests/:id`**: Approves or rejects enterprise space creation requests.
* **`POST /api/admin/business/spaces/:id/suspend`**: Suspends a family space due to billing failure or Terms violation.
* **`POST /api/admin/business/spaces/:id/reinstate`**: Reinstates a suspended family space upon payment resolution.
* **`POST /api/admin/business/billing/refund`**: Executes financial refunds for canceled orders or subscriptions.
* **`POST /api/admin/business/spaces/:id/credits`**: Grants complimentary KCC credits or storage expansions to a space.
* **`GET /api/admin/business/notifications`**: Retrieves business billing alerts and subscription renewal notices.
* **`PATCH /api/admin/business/notifications/:id/read`**: Marks a business notification as read.
* **`PATCH /api/admin/business/notifications/mark-all-read`**: Marks all business notifications as read.
* **`GET /api/admin/ledger/flow`**: Retrieves global Kincore Coin (KCC) token circulation and liquidity flows.

### 2.9 Mall (Marketplace) Admin & Engagement Events
* **`GET /api/admin/mall/listings`**: Lists all merchandise, custom prints, and heritage products in the global store.
* **`GET /api/admin/mall/queue`**: Lists vendor product submissions awaiting administrative review.
* **`PATCH /api/admin/mall/listings/:id/moderate`**: Approves or rejects product listings for marketplace display.
* **`PATCH /api/admin/mall/listings/:id`**: Modifies product pricing, inventory quotas, or promotional imagery.
* **`DELETE /api/admin/mall/listings/:id`**: Removes a product listing from the marketplace.
* **`GET /api/admin/engagement/events`**: Lists global platform-sponsored events and community webinars.
* **`GET /api/admin/engagement/events/:id`**: Retrieves attendance lists and RSVP metrics for a global event.
* **`POST /api/admin/engagement/events`**: Creates a new platform-wide sponsored event.
* **`PUT /api/admin/engagement/events/:id`**: Modifies event dates, speakers, or cover imagery.
* **`DELETE /api/admin/engagement/events/:id`**: Cancels and deletes a global platform event.
* **`GET /api/admin/repository/media`**: Global administrative media file auditor for copyright and storage checks.

### 2.10 HR Administration & Marketing Announcements
* **`GET /api/admin/hr/admins`**: Lists all staff members with administrative access to the Kincore platform.
* **`GET /api/admin/hr/admins/:admin_id/audit`**: Retrieves detailed action audit trail for a specific staff administrator.
* **`DELETE /api/admin/hr/admins/:id`**: Revokes administrative access from a staff member.
* **`GET /api/admin/content/announcements`**: Lists global marketing announcements displayed on app dashboards.
* **`POST /api/admin/content/announcements`**: Publishes a new promotional announcement or feature spotlight.
* **`DELETE /api/admin/content/announcements/:id`**: Removes an active marketing announcement.

### 2.11 Customer Support Ticket Management
* **`GET /api/admin/support/tickets`**: Retrieves user support tickets, bug reports, and assistance requests.
* **`GET /api/admin/support/tickets/:id`**: Retrieves full message conversation and attachments for a support ticket.
* **`POST /api/admin/support/tickets/:id/reply`**: Submits an official administrative reply to resolve a customer ticket.

### 2.12 Security Audit Logs & Compliance Reporting
* **`GET /api/admin/audit-logs`** / **`GET /api/audit-logs`**: Retrieves immutable system audit trails tracking role changes and logins.
* **`GET /api/admin/audit-logs/global`**: Retrieves platform-wide governance and security audit events.
* **`GET /api/admin/business/audit-logs`**: Retrieves financial and billing transaction audit trails.
* **`GET /api/admin/audit-logs/export`**: Exports security audit logs to immutable encrypted archives.
* **`GET /api/admin/compliance/report`**: Generates automated GDPR, SOC2, and data privacy compliance reports.
* **`GET /api/admin/auditor/notifications`**: Retrieves compliance alerts and security breach warnings for auditors.
* **`GET /api/admin/auditor/compliance/scores`**: Retrieves calculated trust and safety compliance scores across spaces.
* **`GET /api/admin/auditor/billing`**: Audits platform billing transparency and financial accuracy reports.

### 2.13 Family Admin & Branch Admin Portals
* **`GET /api/family-admin/spaces`**: Retrieves all family spaces managed by the authenticated `family-admin`.
* **`GET /api/family-admin/spaces/:id/analytics`**: Retrieves engagement metrics and tree completion stats for a space.
* **`POST /api/family-admin/spaces/:id/staff`**: Appoints family members as space moderators or editors (`family_space_staff`).
* **`DELETE /api/family-admin/spaces/:id/staff/:userId`**: Revokes staff management roles from a family member.
* **`GET /api/admin/branch/list`** / **`GET /api/branches`**: Lists all regional branches associated with a clan tree.
* **`POST /api/admin/branch/create`**: Creates a new regional branch unit (e.g., "North American Branch").
* **`PUT /api/admin/branch/:id/assign-head`**: Assigns a user as the Branch Admin or Clan Head for regional governance.

### 2.14 Tree Merging & Governance Proposals
* **`GET /api/governance/proposals`**: Lists active clan council voting proposals and leadership elections.
* **`POST /api/governance/proposals`**: Creates a new administrative voting proposal for family council review.
* **`POST /api/governance/proposals/:id/vote`**: Casts an official council vote (`yes`, `no`, `abstain`) on a proposal.
* **`GET /api/campaigns`**: Lists active fundraising campaigns and reunion donation drives.
* **`POST /api/campaigns`**: Creates a new financial campaign with target fundraising goals.
* **`GET /api/merge/requests`**: Lists pending tree merge requests attempting to unify overlapping lineages.
* **`POST /api/merge/requests/:id/approve`**: Executes graph merging algorithms to unite two distinct family trees.

---
*End of Kincore Complete API Documentation.*
