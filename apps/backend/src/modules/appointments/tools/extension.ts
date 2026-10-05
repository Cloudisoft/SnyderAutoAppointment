import { DateTime } from 'luxon';
import type { Config } from '../../../config';
import { serverFunctionTool, type AssistantExtension } from '../../agents/assistantBuilder';
import type { ExtensionContext } from '../../calls/pipeline';
import { spokenDate, spokenEmail, spokenTime, spokenTimeZone } from '../availability/spoken';
import { appointmentSettingsOf } from '../settings';

/** Platform-wide booking rules appended to the agent prompt (only when booking is enabled). */
export function bookingPromptRules(input: { requireEmail: boolean; emailOnFile: string | null; leadTimeZone: string; now: Date }): string {
  const local = DateTime.fromJSDate(input.now, { zone: input.leadTimeZone });
  const rules = [
    'Offer to schedule a meeting only after the prospect has shown interest.',
    'Call check_availability to get open times. Offer only the times it returns, exactly as written. Never invent, round or guess times.',
    input.requireEmail
      ? 'Ask for their email address, then spell it back in short chunks (for example "j, o, h, n, at gmail dot com") and get a clear yes.'
      : 'Ask for their email address if they are happy to share it, and spell it back in short chunks to confirm.',
    'Before booking, read back the day, date, time and time zone in words and get a clear yes. Then call book_appointment with the slot_id.',
    'If a time was just taken, apologise and offer the new times the tool returns.',
    'After booking, tell them a confirmation email with a link to reschedule or cancel is on its way.',
    'Then thank them, wrap up briefly and end the call.',
    'If a scheduling tool says the calendar is unavailable, do not make up times: offer a follow-up email or a callback instead.',
  ];
  const context = [
    `It is currently ${spokenDate(local, input.now)}, ${spokenTime(local)} ${spokenTimeZone(input.leadTimeZone, input.now)} for the prospect. Times from the tools are already in their time zone.`,
    input.emailOnFile ? `Email on file: ${spokenEmail(input.emailOnFile)}. Confirm it's still the best address, or ask for a new one.` : null,
  ].filter(Boolean);
  return `# Scheduling\n${rules.map((r) => `- ${r}`).join('\n')}\n${context.map((c) => `- ${c}`).join('\n')}`;
}

export function bookingVapiTools(config: Pick<Config, 'BACKEND_PUBLIC_URL' | 'VAPI_WEBHOOK_SECRET'>, requireEmail: boolean) {
  return [
    serverFunctionTool(
      config,
      {
        name: 'check_availability',
        description: 'Get open appointment times to offer the prospect. Returns slot ids with spoken labels.',
        parameters: {
          type: 'object',
          properties: {
            preferred_day: { type: 'string', description: 'Optional day preference, e.g. "tomorrow", "Tuesday", "next week".' },
            preferred_time_of_day: { type: 'string', enum: ['morning', 'afternoon', 'evening', 'any'], description: 'Optional time-of-day preference.' },
          },
        },
      },
      {
        timeoutSeconds: 10,
        messages: [
          { type: 'request-start', content: 'Let me check the calendar.' },
          { type: 'request-response-delayed', content: 'Still checking, one moment.', timingMilliseconds: 3000 },
        ],
      },
    ),
    serverFunctionTool(
      config,
      {
        name: 'book_appointment',
        description: 'Book one of the offered slots after the prospect clearly confirmed the day, date, time and time zone.',
        parameters: {
          type: 'object',
          properties: {
            slot_id: { type: 'string', description: 'The slot id returned by check_availability, e.g. "slot_2".' },
            attendee_name: { type: 'string', description: 'Full name of the person attending.' },
            attendee_email: { type: 'string', description: 'Email address, confirmed by spelling it back.' },
            notes: { type: 'string', description: 'Anything they asked to be noted for the meeting.' },
          },
          required: requireEmail ? ['slot_id', 'attendee_name', 'attendee_email'] : ['slot_id', 'attendee_name'],
        },
      },
      { timeoutSeconds: 12, messages: [{ type: 'request-start', content: 'Great, let me lock that in.' }] },
    ),
  ];
}

/** Adds booking tools and rules to the per-call assistant only when the version has booking enabled. */
export function appointmentsExtension(ctx: ExtensionContext): AssistantExtension | null {
  const settings = appointmentSettingsOf(ctx.snapshot);
  if (!settings.booking_enabled) return null;
  return {
    name: 'appointments',
    optional: true,
    tools: bookingVapiTools(ctx.deps.config, settings.require_email),
    promptSections: [
      bookingPromptRules({
        requireEmail: settings.require_email,
        emailOnFile: ctx.lead.email,
        leadTimeZone: ctx.leadTimeZone,
        now: ctx.deps.clock.now(),
      }),
    ],
  };
}
