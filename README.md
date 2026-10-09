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

## Calls: model, voice, recording

- Agents default to **Claude Haiku 4.5** (Vapi model id `claude-haiku-4-5-20251001`, provider `anthropic`). GPT models are still selectable; the provider is picked from the model id (`packages/shared/src/models.ts`).
- Voices are Cartesia `sonic-3`. Every call has `artifactPlan.recordingEnabled`, so recordings and transcripts land in Call records.
- Live transfers use Vapi's `transferCall` tool (agent → "Live transfer number"). `transfer-update` events flag the call and show in the Live monitor.
- **Settings → Connections** runs live checks of Vapi, Cartesia, Twilio and SMTP with the server's keys.
- **Campaign → Test call setup** sends the campaign's exact assistant config to Vapi (create + delete a temporary assistant, no call placed) and shows what Vapi accepted or rejected.

## Live calls: listen, transfer, hang up

- Every call is placed with live listen/control enabled. **Live monitor** lets supervisors (`monitor.control`) listen to the audio in the browser, have the AI say a line, transfer the call to any number, or end it.
- Transfers: the agent's *Live transfer number* gives the AI a transfer tool, and the prompt tells it to use it when the person asks for a human. If the AI only *says* "let me transfer your call", the server completes the transfer a few seconds later.
- Hang-up: the AI ends the call with its end-call tool after saying goodbye; the platform also hangs up on goodbye phrases, and the server ends a call that is still open ~7 s after a goodbye with no reply.

## Calendar, Google Meet and Zoom

- **Settings → Calendar & meetings**: connect Google (Calendar + Meet) and/or Zoom with OAuth. Tokens are stored encrypted in Vault; Zoom's rotating refresh tokens are persisted on every refresh.
- Appointment types can be *Google Meet* or *Zoom*. When a booking is confirmed, the server creates the Meet/Zoom meeting and (if Google is connected) a Google Calendar event with the prospect and host invited, then sends the confirmation email with a **Join** button, the link in the .ics invite and on the prospect's appointment page.
- Reschedules update the event/meeting; cancellations delete them. Temporary provider errors hold the email for a few retries; a missing/revoked connection sends the email without the link and notifies admins. A `meeting-sync` job retries failures.
- Requires the platform OAuth apps: `GOOGLE_CLIENT_ID/SECRET`, `ZOOM_CLIENT_ID/SECRET` (see `.env.example`).

## Email delivery

- **Platform email (default):** set `PLATFORM_EMAIL_TRANSPORT`, `PLATFORM_EMAIL_API_KEY` and `PLATFORM_EMAIL_FROM` and every organization's appointment emails just work, with no setup: the business name is the sender name and replies go to the host.
- **Own domain (optional):** Settings → Email lets an organization send through its own Resend, SendGrid, Postmark or Brevo account (HTTPS, works everywhere) or its own SMTP server. Railway blocks outbound SMTP on Free/Trial/Hobby plans; SMTP needs the Pro plan.

## Recordings

Recordings are streamed through the backend (`/api/recordings/:id`, short-lived signed links). The calling service may store them privately behind expiring URLs, so when a stored URL no longer works the server fetches a fresh one. Exports contain 30-day signed links.

## Bulk actions and exports

- Leads: select rows (or "select all N matching") → move to list, remove from list, add to / remove from campaign, set status, delete. Leads on a live call are never deleted.
- Lists, voices, call records, DNC and email suppressions have checkbox selection with bulk actions. Deleting call records needs the `calls.manage` permission (owners and admins).
- CSV / Excel downloads: leads (with custom fields and latest call outcome), call records (with recording URL, transcript and summary) and appointments, all respecting the current filters or selection.
- Every failed request shows a toast; nothing fails silently.

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
