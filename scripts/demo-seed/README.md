# Kincore demo seeder

Upsert-only seed that fills every major admin/app module with stable demo data. Safe to re-run — it does **not** wipe existing production rows; it upserts fixed demo UUIDs and refreshes demo account passwords.

## Run

From `backend/`:

```bash
npm run seed:demo
```

Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `backend/.env`.

### App requests only (for `GET /api/app/requests`)

```bash
npm run seed:app-requests
# or a specific space:
node scripts/demo-seed/seed-app-requests.js --space=29c39af1-31da-4579-8cdd-5ed5a55be9d3
```

Seeds `branch_edit_requests` + `claims` for the space owner so the requests list is not empty. You must call the API **logged in as that owner**.

## Demo password

All accounts use: **`Demo@Kincore1`**

## Logins

| Email | Panel / role |
|-------|----------------|
| `family@admin.com` | Super admin |
| `owner@admin.com` | Owner + family owner |
| `council@admin.com` | Council |
| `branch@admin.com` | Branch admin (North Branch) |
| `business@admin.com` | Business |
| `devops@admin.com` | DevOps |
| `auditor@admin.com` | Auditor |
| `coadmin@demo.kincore` | Family admin |
| `member1@demo.kincore` | Member (North) |
| `member2@demo.kincore` | Member (South) |
| `seller@demo.kincore` | Member + mall seller |

## What gets seeded

1. **Users / admins** — auth users + `users` + `admin_users`
2. **Family** — spaces, tree, branches, persons, relations, memberships, staff, history, migration point
3. **Content** — posts, comments, reactions, stories, events, RSVPs, albums, media, chat, bookmarks, notifications
4. **Commerce** — marketplace listings, orders, KCC ledger, ad campaign, fees, subscription plans
5. **Governance** — claims, abuse reports, disputes, governance cases, council assignment, sensitive change, merge request, audit logs
6. **Ops** — background jobs, worker, incident, system log, support ticket, announcement

Primary space code: **`CHEN-DEMO`**
