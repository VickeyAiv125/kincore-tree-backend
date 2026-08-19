# Kincore — Full Database Schema (schema only, no user data)

Use this when migrating to a **new Supabase project** or **self-hosted Postgres** and you do not have access to the old Supabase dashboard.

## What is included

- `full_schema.sql` — one idempotent script: extensions, tables, columns, indexes, and a few **system** defaults (background jobs registry). **No users, families, or demo rows.**

## Apply on a new Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → **New query**.
3. Paste the contents of `full_schema.sql` and run it.
4. In **Project Settings → API**, copy `SUPABASE_URL`, `anon` key, and `service_role` key into your backend `.env`.
5. Enable Auth providers (Email, Google, etc.) under **Authentication → Providers**.
6. Create storage buckets used by the app: `media`, `avatars` (names match `backend/src/config/storageClient.js`).

### Auth note

`public.users.id` references `auth.users(id)`. Rows in `public.users` are created when someone signs up (backend `authService`). You do **not** need to seed users manually.

## Apply with psql (any Postgres)

```bash
psql "$DATABASE_URL" -f backend/schema/full_schema.sql
```

For plain Postgres (not Supabase), comment out or remove the line:

```sql
REFERENCES auth.users(id)
```

and manage user IDs yourself, or install Supabase Auth.

## Optional demo data (after schema)

From `backend/` with `.env` pointing at the new project:

```bash
node scripts/demo-seed/seed.js
```

See `backend/scripts/demo-seed/README.md` if present.

## Source files merged into `full_schema.sql`

| Source | Purpose |
|--------|---------|
| `backend/schema.sql` | Core v3.2 tables |
| `backend/schema_update_v3_2.sql` | Events, Secret Santa |
| `backend/schema_admin_roles.sql` | Admin / support / incidents |
| `backend/migrations/*.sql` | KCC, media attach columns |
| `backend/scripts/*_migration.sql` | DevOps jobs, logs, notifications |
| Codebase `.from('…')` usage | Missing tables & columns inferred from app code |

## Limitations

- Reconstructed from repo + partial backups — not a `pg_dump` of production.
- RLS policies are minimal; the API uses the **service role** key for most admin operations.
- Storage buckets and Supabase Auth settings are configured outside SQL.
