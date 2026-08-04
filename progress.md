# Kincore Admin Panel - Progress Log

## Phase 1: Core Backend & App Integration (Completed)

### 1. Family Tree Data API
- **Endpoint**: `GET /api/tree/data`
- **Controller**: `treeController.getTreeData`
- **Features**: 
    - Securely fetches nodes and relationships.
    - **Auto-Filtering**: Automatically filters data by `family_space_id` for regular mobile users.
    - **Dual Access**: Platform Admins can view all trees, while users only see their own family.

### 2. RBAC & Security Middleware
- **Middleware**: `rbacMiddleware.optionalPlatformAdmin`
- **Capability**: Identifies if a request is from a Platform Admin vs. a regular user without blocking access.
- **Routes**: Implemented in `treeRoutes.js`.

### 3. WebView App-Mode Integration
- **Frontend Logic**: 
    - URL query parameter `?view=app` detection.
    - **Layout Bypass**: Modified `Layout.jsx` to hide sidebars, headers, and footers when in App Mode.
    - **UI Cleanup**: Modified `FamilyTree.jsx` to hide editing panels and project headers for a native mobile experience.
- **Route Protection**: Updated `Layout.jsx` to bypass role-based dashboard redirects when using `view=app`.

### 4. Flutter Integration Strategy
- **Mechanism**: WebView (InAppWebView).
- **Target URL**: `[DOMAIN]/owner/family-tree?view=app`.
- **Auth**: Flutter passes the user's JWT token for identity verification.

---

## Phase 2: Role-Based Admin Controllers (In Progress)

### 1. DevOps Role (Implemented)
- **Controller**: `devopsController.js`
- **APIs**: 
    - `getIncidents`: List all system issues.
    - `createIncident`: Log new server/system failures.
    - `resolveIncident`: Mark issues as fixed with timeline notes.
- **Tables**: `system_incidents`, `incident_timeline`.

### 2. Auditor Role (Implemented)
- **Controller**: `auditorController.js`
- **APIs**:
    - `getAbuseReports`: Fetch all flagged content/users.
    - `resolveAbuseReport`: Take moderator action (Ban user, Delete content).
- **Tables**: `abuse_reports`.

### 3. Core Admin Enhancements (Implemented)
- **APIs**: Refined `getStats`, `updateUserRole`, and `updateUserStatus`.
- **RBAC**: Enforced `super_admin`, `owner`, `council`, `devops`, and `auditor` hierarchies across all routes.

### 4. Business (Sae) Role (Implemented)
- **Controller**: `businessController.js`
- **APIs**:
    - `getRevenueStats`: Revenue tracking from memberships/ledger.
    - `listSubscriptions`: User billing status overview.
    - `updateSubscription`: Manual plan adjustments.
- **Tables**: `platform_subscriptions`.

### 5. Member Support Role (Implemented)
- **Controller**: `supportController.js`
- **APIs**:
    - `getTickets`: Support request queue.
    - `getTicketDetails`: Full message thread.
    - `replyToTicket`: Internal and external support responses.
- **Tables**: `support_tickets`, `ticket_messages`.

### 6. HR Role (Implemented)
- **Controller**: `hrController.js`
- **APIs**:
    - `getAdmins`: List the internal admin team.
    - `getAdminAudit`: Performance and action tracking for admins.
    - `removeAdmin`: Revoking internal access.

### 7. Content Creator Role (Implemented)
- **Controller**: `contentController.js`
- **APIs**:
    - `getAnnouncements`: Public platform news.
    - `createAnnouncement`: Publish news/blogs.
- **Tables**: `announcements`.

### 8. Page-by-Page UI Mapping (Completed)
- **Dashboard**: `dashboard/overview` - Provides stats for all 5 top cards + charts.
- **Lineage Registry**: `lineage/trees`, `lineage/persons`.
- **Governance**: `users`, `hr/admins`, `audit-logs`.
- **Content Moderation**: `moderation/queue`.
- **Events**: `engagement/events`.
- **Mall**: `mall/listings`.
- **Repository**: `repository/media`.
- **Subscription**: `business/subscriptions`.
- **KCC Coin**: `ledger/flow`.

## Phase 3: Family Admin Dashboard & Governance (Active)

### 1. Dynamic Family Dashboard
- **Implementation**: Fully connected `OwnerDashboard.jsx` to live backend data.
- **Auto-Resolution**: Backend now automatically resolves `DEFAULT_FAMILY_ID` to the logged-in user's real family.
- **Live Stats**: Real-time counts for Members, Lineage, and Activity.

### 2. Family Governance & Separation
- **Owner vs Admin**: Enforced strict RBAC. 
    - **Owner Only**: Appointing Admins, deleting tree, changing privacy.
    - **Admin**: Daily operations, editing members.
- **Endpoint Protection**: Updated `familyRoutes.js` and `rbacMiddleware.js`.

### 3. Member Management & S3 Integration
- **API**: `POST /api/tree/add-member` for adding detailed lineage profiles.
- **Media**: Integrated `mediaController` with the "Add Member" form.
- **Features**: 
    - Instant preview for profile photos.
    - Automatic upload to Supabase **S3 Storage** (media bucket).
    - Real-time search/link for tree relationships.

### 4. Required Database Sync (SQL Commands)
> [!IMPORTANT]
> Run these in Supabase SQL Editor if you encounter 500 errors:
- **Missing Columns**: `ALTER TABLE persons ADD COLUMN IF NOT EXISTS is_alive BOOLEAN DEFAULT true;`
- **Owner Link**: `link_owner.js` script handles linking accounts to family spaces.

### 5. Branch Management (Implemented)
- **Database**: Created `family_branches` table with head-member linking.
- **Backend**: `branchController.js` and `/api/branches` routes.
- **Frontend**: Full dynamic listing, branch creation, and empty states.

### 6. Custom Role Labels (Implemented)
- **Feature**: Allows owners to rename system roles (e.g., "Member" -> "Clan Cousin").
- **Database**: Created `family_custom_labels` table.
- **Backend**: GET/POST endpoints with **"Smart Mapping"** to handle spacing/casing inconsistencies.
- **Frontend**: Fully dynamic `/owner/custom-labels` page with original aesthetic integrity.

### 7. Unified Member Registry (Enhanced)
- **Deep Recovery**: Updated `getMembers` to fetch both direct accounts and lineage-only profiles linked via the tree.
- **Role Integration**: Registry now automatically displays the custom labels defined by the owner.
- **Visibility**: Fixed visibility bugs where lineage members were hidden from the administrative list.

### 8. Resilient Event Invitations (Enhanced)
- **Schema Resolution**: Fixed `updated_at` column error in `events` table sync.
- **Metadata Fallback**: Implemented hidden metadata tags in event descriptions to ensure invitations for lineage-profiles (non-accounts) "stick" and persist across edits.

### 9. Required Database Sync (SQL Commands)
> [!IMPORTANT]
> Run these in Supabase SQL Editor if you encounter errors:
- **Custom Labels**: 
  ```sql
  CREATE TABLE IF NOT EXISTS family_custom_labels (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      family_space_id UUID REFERENCES family_spaces(id) ON DELETE CASCADE,
      role_key VARCHAR(50) NOT NULL,
      custom_label VARCHAR(100) NOT NULL,
      UNIQUE(family_space_id, role_key)
  );
  ```
- **Members Cache**: `ALTER TABLE persons ADD COLUMN IF NOT EXISTS is_alive BOOLEAN DEFAULT true;`

---

### Next Actions:
- [x] Integrate Custom Labels into Member Registry.
- [x] Fix RSVP persistence for lineage-profiles.
- [ ] Connect `EditMember.jsx` to the `PATCH` role-update endpoint.
- [ ] Implement Governance Policies & Privacy Settings pages logic.
- [ ] Verify Branch Management sync with tree visualization.
- [ ] Live testing of automated tree branch creation.
