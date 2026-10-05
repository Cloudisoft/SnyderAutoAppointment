# Auto Appointments

Universal booking for any campaign. When a prospect agrees to meet, the AI offers real open
slots, holds one during the call, and the end-of-call pipeline confirms it and emails the
prospect a personal link for that exact date and time.

## Flow

1. **Dial.** If the published campaign version has `appointments.booking_enabled`, the per-call
   Vapi assistant gets `check_availability` + `book_appointment` function tools (server URL
   `${BACKEND_PUBLIC_URL}/webhooks/vapi`, secret `VAPI_WEBHOOK_SECRET`) and the platform booking
   rules. If Vapi rejects the tools, the call is re-sent without them (logged, call event).
2. **Offer.** `check_availability` returns up to `slots_to_offer` slots (short ids `slot_N`, stored on
   the call) with Cartesia-friendly labels: "Tuesday, October thirteenth at eleven a.m. Eastern".
   It answers within 4.5 s or returns a "calendar is slow, offer a follow-up" message.
3. **Hold.** `book_appointment` validates the email and inserts a `pending` appointment with
   `hold_expires_at = now + hold_minutes`. The `appointments_no_double_booking` exclusion
   constraint makes overlaps impossible; on conflict the tool returns fresh alternatives.
4. **Finalize.** The end-of-call webhook and the reconciliation job share one idempotent step:
   connected calls confirm (`token_expires_at = ends_at + 30 days`, events, lead status,
   "Appointment booked" disposition, confirmation + host notice queued). Voicemail, DNC, no
   answer and failed calls release the hold and never confirm.
5. **Email.** The dispatcher sends the confirmation (HTML + text + `.ics`, Google/Outlook links)
   with `{APPOINTMENTS_PUBLIC_URL}/a/{token}`. Each email that carries a link mints a fresh
   32-byte URL-safe token; only its SHA-256 hash is stored (`appointment_tokens`).
6. **Manage.** `/a/:token` (no login) shows the appointment and lets the prospect reschedule
   (only open slots, atomic swap, SEQUENCE+1) or cancel (`.ics METHOD:CANCEL`).
7. **Jobs.** Hold expiry, notification dispatch (retries 1m/5m/15m/1h/3h, real SMTP error
   recorded), reminders (default 24h + 1h, once each), no-show (2h after end).

Transcript fallback: if a connected call has no appointment but the OpenAI post-call extraction
finds an agreed time, a `needs_review` appointment is created (no email) and supervisors are
notified in-app; confirming it from the Appointments page sends the email.

## Design notes

- **Tokens.** The brief asks for one token generated at finalization with only its hash stored.
  Because the raw token can't be recovered from a hash, and emails are sent asynchronously with
  retries (and reminders/reschedules also need the link), a token is minted at send time for each
  email that includes a link. All of an appointment's tokens remain valid until
  `ends_at + 30 days`; `appointments.token_hash` holds the latest one. Finalization sets
  `token_expires_at`.
- **Buffers.** The constraint compares each appointment's buffered window
  (`starts_at - buffer_before`, `ends_at + buffer_after`), so two appointments must be separated by
  `A.after + B.before`. Slot generation uses exactly the same rule.
- **Version / SEQUENCE.** `appointments.version` increments on reschedule and cancel and is used as
  the `.ics` SEQUENCE and in the notification idempotency key.
- **SMS.** Notifications have a `channel`; SMS is routed to a stub that only runs when
  `SMS_APPOINTMENTS_ENABLED=true` *and* the campaign enables it. Inbound STOP/START is handled at
  `/webhooks/twilio/sms` (Twilio-signed) into `sms_opt_outs`.

## Required tests → where they live (`apps/backend`)

| Requirement | Test file |
|---|---|
| Slot generation: buffers, min notice, max days, exceptions, DST, lead vs host zone | `src/modules/appointments/availability/slots.test.ts`, `service.test.ts` |
| Spoken labels in words, no slashes/digits/IANA ids; email spelling | `src/modules/appointments/availability/spoken.test.ts` |
| 10 parallel `book_appointment` for one slot → exactly one succeeds | `src/modules/appointments/tools/bookingTools.test.ts` |
| Duplicate end-of-call webhooks confirm once, send one email | `src/modules/appointments/jobs.test.ts`, `finalize.test.ts` |
| Hold expiry releases the slot; reconciliation finalizes on a lost webhook | `jobs.test.ts`, `finalize.test.ts`, `src/modules/calls/webhook.test.ts` |
| Disposition order (DNC/voicemail win, Appointment booked beats Call connected) | `src/modules/dispositions/engine.test.ts`, `finalize.test.ts`, `schema.test.ts` |
| Tool failure keeps the call going, nothing thrown to Vapi | `bookingTools.test.ts`, `src/modules/calls/webhook.test.ts` |
| Requests without a valid `VAPI_WEBHOOK_SECRET` rejected | `src/modules/calls/webhook.test.ts` |
| Token security: hash only; unknown/expired → 404 | `jobs.test.ts`, `publicRoutes.test.ts` |
| Email rendering: placeholders, stripping, valid `.ics`, stable UID, SEQUENCE | `src/modules/appointments/email/render.test.ts`, `src/lib/templates.test.ts` |
| RLS: one org can't read another's appointments | `src/modules/appointments/schema.test.ts` |
| Booking tools only when enabled; Vapi rejection fallback | `bookingTools.test.ts` |
