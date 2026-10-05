# Snyder Auto Appointment

AI outbound calling platform (Vapi + Cartesia + Twilio) on Supabase.

| Path | What |
|---|---|
| `apps/backend` | Node 22 + Fastify API, Vapi webhooks, background jobs |
| `apps/frontend` | React + Vite + Tailwind + React Query web app |
| `packages/shared` | Types and Zod schemas shared by both apps |
| `supabase/migrations` | Numbered SQL migrations (`NNNN_name.sql`), RLS scoped to `organization_id` |

## Develop

```bash
pnpm install
cp .env.example .env          # fill in values
pnpm db:migrate               # or: supabase db push
pnpm dev
```

## Test

Backend DB suites run against a real Postgres 16 (with `btree_gist`). The test harness creates
a throwaway database, installs a small Supabase shim (`supabase/test/supabase_shim.sql`) and
applies every migration.

```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
SKIP_DB_TESTS=1 pnpm test     # pure suites only
```

## Auto Appointments

See [docs/auto-appointments.md](docs/auto-appointments.md) for the booking flow, design notes and
the test map. Migration `0009_appointments.sql` adds the data model; new env vars are documented
in `.env.example` under "Auto Appointments".

## Background jobs

Jobs run in the API process when `JOBS_ENABLED=true` (each guarded by a Postgres advisory lock so
multiple instances are safe): `dialer`, `call-reconcile`, `appointment-hold-expiry`,
`appointment-notification-dispatch`, `appointment-reminders`, `appointment-no-show`.

## Deploy (Railway)

One service deploys the whole monorepo. Service settings (set in Railway):

| Setting | Value |
|---|---|
| Build command | `pnpm --filter @snyder/backend build && pnpm --filter @snyder/frontend build` |
| Pre-deploy command | `node apps/backend/dist/db/migrate.js` (applies pending migrations) |
| Start command | `node apps/backend/dist/index.js` |
| Healthcheck path | `/health` |

The backend serves the API, webhooks, the public appointment page and the web app
(`FRONTEND_DIST_DIR=apps/frontend/dist`).
Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` as service variables so they are present at build time.
Use Supabase's **Session pooler** connection string for `DATABASE_URL` (IPv4).
