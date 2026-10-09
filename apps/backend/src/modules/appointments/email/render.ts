import { DEFAULT_CONFIRMATION_BODY, DEFAULT_CONFIRMATION_SUBJECT, type AppointmentSettings } from '@snyder/shared';
import { DateTime } from 'luxon';
import type { Config } from '../../../config';
import type { DbClient } from '../../../db/pool';
import type { OutgoingEmail } from '../../../integrations/mailer';
import { escapeHtml, leadVars, renderTemplate, type TemplateVars } from '../../../lib/templates';
import { loadVersionSnapshot } from '../../campaigns/service';
import { appointmentSettingsOf } from '../settings';
import { button, detailsTable, joinCard, layout, link as brandLink, whenBlock, type Tone } from './brand';
import { buildIcs } from './ics';
import { googleCalendarUrl, outlookCalendarUrl } from './calendarLinks';

export type EmailKind = 'confirmation' | 'reschedule' | 'cancellation' | 'reminder' | 'host_notice';

export interface EmailTemplate {
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES: Record<EmailKind, EmailTemplate> = {
  confirmation: { subject: DEFAULT_CONFIRMATION_SUBJECT, body: DEFAULT_CONFIRMATION_BODY },
  reschedule: {
    subject: '↻ New time: {{appointment_type}} on {{appointment_date}} at {{appointment_time}}',
    body: `Hi {{first_name}},

Your {{appointment_type}} with {{host_name}} has a new time. The updated calendar invite is attached, so your calendar will update automatically.

Where: {{location}}

Need another change? Use your personal link: {{appointment_link}}

Thanks,
{{business_name}}`,
  },
  cancellation: {
    subject: 'Cancelled: {{appointment_type}} on {{appointment_date}}',
    body: `Hi {{first_name}},

Your {{appointment_type}} with {{host_name}} on {{appointment_date}} at {{appointment_time}} has been cancelled, and it has been removed from your calendar.

Want to pick another time? Just reply to this email and we'll sort it out.

{{business_name}}`,
  },
  reminder: {
    subject: '⏰ Reminder: {{appointment_type}} with {{host_name}} at {{appointment_time}}',
    body: `Hi {{first_name}},

A friendly reminder that your {{appointment_type}} with {{host_name}} is coming up.

Where: {{location}}

Can't make it? Reschedule or cancel with your personal link: {{appointment_link}}

See you soon,
{{business_name}}`,
  },
  host_notice: {
    subject: '★ New booking: {{lead_name}}, {{appointment_date}} at {{appointment_time}}',
    body: `Hi {{host_name}},

{{lead_name}} just booked an appointment with you ({{appointment_type}}) via {{campaign_name}}. The details and the call summary are below.

Where: {{location}}`,
  },
};

export interface AppointmentEmailContext {
  appointment: {
    id: string;
    organization_id: string;
    starts_at: Date;
    ends_at: Date;
    status: string;
    version: number;
    lead_time_zone: string;
    attendee_name: string | null;
    attendee_email: string | null;
    notes: string | null;
    call_id: string | null;
    campaign_version_id: string | null;
  };
  type: { name: string; duration_minutes: number; location_type: string; location_details: string | null; description: string | null };
  host: { display_name: string; email: string; time_zone: string };
  lead: {
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone_e164: string | null;
    company: string | null;
    custom_fields: Record<string, unknown>;
  } | null;
  organizationName: string;
  campaignName: string;
  businessName: string;
  agentName: string;
  settings: AppointmentSettings | null;
  callSummary: string | null;
  /** Video meeting created for this appointment (Google Meet / Zoom), if any. */
  meeting: { provider: string | null; join_url: string | null } | null;
}

export async function loadEmailContext(db: DbClient, appointmentId: string): Promise<AppointmentEmailContext> {
  const { rows } = await db.query(
    `select a.*, t.name as t_name, t.duration_minutes, t.location_type, t.location_details, t.description as t_description,
            h.display_name, h.email as host_email, h.time_zone as host_tz, o.name as org_name,
            l.first_name, l.last_name, l.email as lead_email, l.phone_e164, l.company, l.custom_fields,
            c.summary as call_summary, m.provider as meeting_provider, m.join_url as meeting_join_url, m.status as meeting_status
       from appointments a
       join appointment_types t on t.id = a.appointment_type_id
       join appointment_hosts h on h.id = a.host_id
       join organizations o on o.id = a.organization_id
       left join leads l on l.id = a.lead_id
       left join calls c on c.id = a.call_id
       left join appointment_meetings m on m.appointment_id = a.id
      where a.id = $1`,
    [appointmentId],
  );
  const r = rows[0];
  if (!r) throw new Error(`appointment ${appointmentId} not found`);
  const snapshot = r.campaign_version_id ? await loadVersionSnapshot(db, r.campaign_version_id) : null;
  return {
    appointment: r,
    type: { name: r.t_name, duration_minutes: r.duration_minutes, location_type: r.location_type, location_details: r.location_details, description: r.t_description },
    host: { display_name: r.display_name, email: r.host_email, time_zone: r.host_tz },
    lead: r.phone_e164 || r.first_name
      ? { first_name: r.first_name, last_name: r.last_name, email: r.lead_email, phone_e164: r.phone_e164, company: r.company, custom_fields: r.custom_fields ?? {} }
      : null,
    organizationName: r.org_name,
    campaignName: snapshot?.campaign_name ?? r.org_name,
    businessName: snapshot?.business_name || snapshot?.campaign_name || r.org_name,
    agentName: snapshot?.agent.voice.name ?? '',
    settings: snapshot ? appointmentSettingsOf(snapshot) : null,
    callSummary: r.call_summary ?? null,
    meeting: r.meeting_status && r.meeting_status !== 'deleted' ? { provider: r.meeting_provider, join_url: r.meeting_join_url } : null,
  };
}

export function locationText(ctx: AppointmentEmailContext): string {
  const d = ctx.type.location_details?.trim();
  const join = ctx.meeting?.join_url;
  switch (ctx.type.location_type) {
    case 'google_meet':
      return join ? `Google Meet: ${join}` : 'Google Meet (the link will be emailed to you)';
    case 'zoom':
      return join ? `Zoom: ${join}` : 'Zoom (the link will be emailed to you)';
    case 'phone':
      return d ? `Phone call: ${d}` : `Phone call. ${ctx.host.display_name} will call you${ctx.lead?.phone_e164 ? ` at ${ctx.lead.phone_e164}` : ''}.`;
    case 'video':
      return d ? `Video call: ${d}` : 'Video call (link to follow)';
    case 'in_person':
      return d ? `In person: ${d}` : 'In person';
    default:
      return d || 'Details to follow';
  }
}

function zoneName(zone: string, at: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ??
    zone
  );
}

/** Placeholder values. Times are in `zone` (the prospect's zone, or the host's for host notices). */
export function emailVars(ctx: AppointmentEmailContext, zone: string, link: string | null): TemplateVars {
  const start = DateTime.fromJSDate(ctx.appointment.starts_at, { zone });
  const leadName =
    [ctx.lead?.first_name, ctx.lead?.last_name].filter(Boolean).join(' ') || ctx.appointment.attendee_name || 'A prospect';
  return {
    ...(ctx.lead ? leadVars(ctx.lead) : {}),
    first_name: ctx.lead?.first_name || ctx.appointment.attendee_name?.split(' ')[0] || '',
    lead_name: leadName,
    agent_name: ctx.agentName,
    campaign_name: ctx.campaignName,
    business_name: ctx.businessName,
    appointment_date: start.toFormat('cccc, LLLL d, yyyy'),
    appointment_time: start.toFormat('h:mm a'),
    time_zone: zoneName(zone, ctx.appointment.starts_at),
    duration: `${ctx.type.duration_minutes} minutes`,
    host_name: ctx.host.display_name,
    appointment_type: ctx.type.name,
    location: locationText(ctx),
    appointment_link: link ?? '',
  };
}

/** Turns a rendered plain-text body into simple paragraphs; the appointment link becomes a link. */
function bodyToHtml(template: string, vars: TemplateVars, link: string | null): string {
  const LINK_MARK = '\u0000LINK\u0000';
  const text = renderTemplate(template, { ...vars, appointment_link: link ? LINK_MARK : '' });
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const html = escapeHtml(p)
        .replace(/\n/g, '<br>')
        .replace(LINK_MARK, link ? brandLink(link) : '');
      return `<p style="margin:0 0 14px">${html}</p>`;
    })
    .join('\n');
}

export interface RenderOptions {
  kind: EmailKind;
  template: EmailTemplate;
  /** Public appointment link for the prospect (null for host notices / cancellations). */
  link: string | null;
  config: Pick<Config, 'APPOINTMENTS_PUBLIC_URL' | 'APP_PUBLIC_URL' | 'SMTP_FROM_EMAIL'>;
  now: Date;
}

export function icsUid(appointmentId: string, publicUrl: string): string {
  return `appointment-${appointmentId}@${new URL(publicUrl).hostname}`;
}

/** Renders subject, HTML and plain text (+ .ics) for one appointment email. */
export function renderAppointmentEmail(ctx: AppointmentEmailContext, o: RenderOptions): Omit<OutgoingEmail, 'to'> {
  const forHost = o.kind === 'host_notice';
  const zone = forHost ? ctx.host.time_zone : ctx.appointment.lead_time_zone;
  const vars = emailVars(ctx, zone, o.link);
  const subject = renderTemplate(o.template.subject, vars).replace(/\s+/g, ' ').trim();
  const title = `${ctx.type.name} with ${forHost ? (vars.lead_name as string) : ctx.host.display_name}`;
  const details: [string, string][] = [
    ['When', `${vars.appointment_date} at ${vars.appointment_time} (${vars.time_zone})`],
    ['Duration', vars.duration as string],
    [forHost ? 'With' : 'Host', forHost ? (vars.lead_name as string) : ctx.host.display_name],
    ['Where', vars.location as string],
  ];
  if (forHost && ctx.lead) {
    if (ctx.lead.phone_e164) details.push(['Phone', ctx.lead.phone_e164]);
    const email = ctx.appointment.attendee_email ?? ctx.lead.email;
    if (email) details.push(['Email', email]);
    if (ctx.lead.company) details.push(['Company', ctx.lead.company]);
  }
  if (ctx.appointment.notes) details.push(['Notes', ctx.appointment.notes]);

  const calendar = {
    title,
    start: ctx.appointment.starts_at,
    end: ctx.appointment.ends_at,
    details: [ctx.meeting?.join_url ? `Join: ${ctx.meeting.join_url}` : null, ctx.type.description, o.link ? `Manage: ${o.link}` : null].filter(Boolean).join('\n'),
    location: ctx.meeting?.join_url ?? (vars.location as string),
  };
  const cancelled = o.kind === 'cancellation';
  const buttons: string[] = [];
  const textLinks: string[] = [];
  const joinUrl = ctx.meeting?.join_url;
  if (joinUrl && !cancelled) {
    const label = ctx.type.location_type === 'zoom' ? 'Join Zoom meeting' : ctx.type.location_type === 'google_meet' ? 'Join Google Meet' : 'Join meeting';
    textLinks.push(`${label}: ${joinUrl}`);
  }
  if (o.link && !cancelled) {
    buttons.push(button(o.link, 'Manage appointment', !joinUrl));
    textLinks.push(`Manage appointment: ${o.link}`);
  }
  if (!cancelled) {
    const g = googleCalendarUrl(calendar);
    const ms = outlookCalendarUrl(calendar);
    buttons.push(button(g, 'Add to Google Calendar'), button(ms, 'Add to Outlook'));
    textLinks.push(`Add to Google Calendar: ${g}`, `Add to Outlook: ${ms}`);
  }
  let hostExtra = '';
  let hostExtraText = '';
  if (forHost) {
    const appLink = `${o.config.APP_PUBLIC_URL.replace(/\/$/, '')}/appointments?id=${ctx.appointment.id}`;
    const callLink = ctx.appointment.call_id ? `${o.config.APP_PUBLIC_URL.replace(/\/$/, '')}/calls?call=${ctx.appointment.call_id}` : null;
    hostExtra =
      (ctx.callSummary ? `<p style="margin:0 0 8px;font-weight:600">Call summary</p><p style="margin:0 0 16px">${escapeHtml(ctx.callSummary)}</p>` : '') +
      button(appLink, 'Open appointment', true) +
      (callLink ? button(callLink, 'View call') : '');
    hostExtraText = [ctx.callSummary ? `Call summary: ${ctx.callSummary}` : null, `Open appointment: ${appLink}`, callLink ? `View call: ${callLink}` : null]
      .filter(Boolean)
      .join('\n');
  }

  const look: Record<EmailKind, { heading: string; pill: string; tone: Tone; when: string }> = {
    confirmation: { heading: 'Your appointment is confirmed', pill: '✓ Confirmed', tone: 'success', when: 'Your appointment' },
    reschedule: { heading: 'Your appointment has moved', pill: '↻ Rescheduled', tone: 'brand', when: 'New time' },
    cancellation: { heading: 'Your appointment was cancelled', pill: '✕ Cancelled', tone: 'danger', when: 'Cancelled appointment' },
    reminder: { heading: 'See you soon', pill: '⏰ Reminder', tone: 'brand', when: 'Coming up' },
    host_notice: { heading: `New booking: ${vars.lead_name as string}`, pill: '★ New appointment', tone: 'success', when: 'Booked for' },
  };
  const k = look[o.kind];
  const logoUrl = `${o.config.APP_PUBLIC_URL.replace(/\/$/, '')}/brand/logo-light.png`;
  const html = layout({
    logoUrl,
    businessName: ctx.businessName,
    preheader: `${ctx.type.name} · ${vars.appointment_date as string} at ${vars.appointment_time as string}`,
    pill: { text: k.pill, tone: k.tone },
    heading: k.heading,
    inner: `${whenBlock({ label: k.when, date: vars.appointment_date as string, time: vars.appointment_time as string, zone: vars.time_zone as string, strike: cancelled })}
${joinUrl && !cancelled ? joinCard({ provider: ctx.type.location_type, url: joinUrl }) : ''}
${bodyToHtml(o.template.body, vars, o.link)}
${detailsTable(details)}
${hostExtra}
<div style="margin-top:4px">${buttons.join('')}</div>`,
    footer: escapeHtml(`Sent by ${ctx.businessName}${o.link && !forHost ? ' · This link is personal to you; please don’t forward it.' : ''}`),
  });
  const text = [
    renderTemplate(o.template.body, vars),
    '',
    ...details.map(([k, v]) => `${k}: ${v}`),
    '',
    hostExtraText,
    ...textLinks,
  ]
    .filter((l, i, arr) => !(l === '' && arr[i - 1] === ''))
    .join('\n')
    .trim();

  const organizerEmail = o.config.SMTP_FROM_EMAIL || ctx.host.email;
  const attendee = forHost
    ? { name: ctx.host.display_name, email: ctx.host.email }
    : ctx.appointment.attendee_email
      ? { name: ctx.appointment.attendee_name ?? (vars.first_name as string), email: ctx.appointment.attendee_email }
      : undefined;
  const ics = buildIcs({
    uid: icsUid(ctx.appointment.id, o.config.APPOINTMENTS_PUBLIC_URL),
    sequence: ctx.appointment.version,
    method: cancelled ? 'CANCEL' : 'REQUEST',
    start: ctx.appointment.starts_at,
    end: ctx.appointment.ends_at,
    stamp: o.now,
    summary: title,
    description: calendar.details,
    location: calendar.location,
    url: o.link && !cancelled ? o.link : undefined,
    organizer: { name: ctx.businessName, email: organizerEmail },
    attendee,
  });

  return {
    subject,
    html,
    text,
    fromName: ctx.businessName,
    icalEvent: { method: cancelled ? 'CANCEL' : 'REQUEST', filename: cancelled ? 'cancel.ics' : 'invite.ics', content: ics },
  };
}

/** Template for a notification: campaign confirmation override, then org default, then built-in. */
export async function resolveTemplate(db: DbClient, organizationId: string, kind: EmailKind, settings: AppointmentSettings | null): Promise<EmailTemplate> {
  if (kind === 'confirmation' && settings?.confirmation_email.subject.trim() && settings.confirmation_email.body.trim()) {
    const isDefault =
      settings.confirmation_email.subject === DEFAULT_CONFIRMATION_SUBJECT && settings.confirmation_email.body === DEFAULT_CONFIRMATION_BODY;
    if (!isDefault) return settings.confirmation_email;
  }
  const { rows } = await db.query<EmailTemplate>(
    'select subject, body from appointment_email_templates where organization_id = $1 and type = $2',
    [organizationId, kind],
  );
  return rows[0] ?? DEFAULT_TEMPLATES[kind];
}

export function appointmentLink(publicUrl: string, token: string): string {
  return `${publicUrl.replace(/\/$/, '')}/a/${token}`;
}
