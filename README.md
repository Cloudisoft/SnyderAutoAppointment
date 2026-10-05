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
