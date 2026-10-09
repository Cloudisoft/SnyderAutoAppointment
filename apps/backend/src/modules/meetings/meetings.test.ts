import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testConfig, testDeps } from '../../../test/helpers/deps';
import { FakeGoogle, FakeMailer, FakeZoom } from '../../../test/helpers/fakes';
import { bookAndConfirm, createBookingCampaign } from '../../../test/helpers/fixtures';
import { accessTokenFor, clearTokenCache, saveConnection, signState } from './connections';
import { meetingTiming } from './sync';

let n = 0;
const phone = () => `+1646555${String(3000 + ++n).slice(-4)}`;

describeDb('Google Meet and Zoom meetings', () => {
  let org: SeededOrg;
  let google: FakeGoogle;
  let zoom: FakeZoom;
  let mailer: FakeMailer;
  const deps = () => testDeps({ google, zoom, mailer });

  beforeAll(async () => {
    meetingTiming.meetPollMs = 1;
  });
  beforeEach(async () => {
    org = await seedOrg(testPool());
    google = new FakeGoogle();
    zoom = new FakeZoom();
    mailer = new FakeMailer();
    clearTokenCache();
  });
  afterAll(closeTestPool);

  const connect = (provider: 'google' | 'zoom') =>
    saveConnection(deps(), {
      organizationId: org.orgId,
      provider,
      userId: org.ownerId,
      tokens: { accessToken: `${provider}-a`, refreshToken: `${provider}-r`, expiresIn: 3600 },
      account: { email: provider === 'google' ? 'calendar@acme.test' : 'host@acme.test' },
    });

  it('connects Google through OAuth with a signed state and lists the connection', async () => {
    const app = await buildApp(deps());
    const h = bearerFor(org.ownerId);
    const start = await app.inject({ method: 'POST', url: '/api/integrations/google/connect', headers: h });
    const url = new URL(start.json().url);
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.example.test/api/integrations/google/callback');
    const state = url.searchParams.get('state')!;

    const bad = await app.inject({ method: 'GET', url: `/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state.slice(0, -2) + 'xx')}` });
    expect(bad.statusCode).toBe(302);
    expect(bad.headers.location).toContain('error=');
    const wrongProvider = await app.inject({ method: 'GET', url: `/api/integrations/zoom/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(wrongProvider.headers.location).toContain('error=');

    const ok = await app.inject({ method: 'GET', url: `/api/integrations/google/callback?code=abc&state=${encodeURIComponent(state)}` });
    expect(ok.headers.location).toBe('https://app.example.test/settings/integrations?connected=google');
    const list = (await app.inject({ method: 'GET', url: '/api/integrations', headers: h })).json();
    expect(list.find((p: { provider: string }) => p.provider === 'google')).toMatchObject({ connected: true, account_email: 'calendar@acme.test', available: true });

    expect((await app.inject({ method: 'DELETE', url: '/api/integrations/google', headers: h })).statusCode).toBe(200);
    const after = (await app.inject({ method: 'GET', url: '/api/integrations', headers: h })).json();
    expect(after.find((p: { provider: string }) => p.provider === 'google').connected).toBe(false);
  });

  it('returns to the domain the admin started from (custom domain), never to an unknown one', async () => {
    const app = await buildApp(testDeps({ google, zoom, mailer, config: testConfig({ CORS_ORIGINS: 'https://app.example.test,https://portal.acme.test' }) }));
    const h = bearerFor(org.ownerId);
    const go = async (return_to: string) => {
      const url = new URL((await app.inject({ method: 'POST', url: '/api/integrations/google/connect', headers: h, payload: { return_to } })).json().url);
      return (await app.inject({ method: 'GET', url: `/api/integrations/google/callback?code=c&state=${encodeURIComponent(url.searchParams.get('state')!)}` })).headers.location;
    };
    expect(await go('https://portal.acme.test')).toBe('https://portal.acme.test/settings/integrations?connected=google');
    expect(await go('https://evil.example')).toBe('https://app.example.test/settings/integrations?connected=google');
  });

  it('rejects a callback for a user without permission and expired states', async () => {
    const app = await buildApp(deps());
    const viewer = await org.addUser('viewer');
    const now = new Date('2026-10-12T14:00:00Z'); // the test clock
    const s1 = signState('test-vapi-webhook-secret-0123456789', { organizationId: org.orgId, userId: viewer, provider: 'google' }, now);
    expect((await app.inject({ method: 'GET', url: `/api/integrations/google/callback?code=x&state=${encodeURIComponent(s1)}` })).headers.location).toContain('permission');
    const old = signState('test-vapi-webhook-secret-0123456789', { organizationId: org.orgId, userId: org.ownerId, provider: 'google' }, new Date(now.getTime() - 3_600_000));
    expect((await app.inject({ method: 'GET', url: `/api/integrations/google/callback?code=x&state=${encodeURIComponent(old)}` })).headers.location).toContain('expired');
  });

  it('Google Meet: books into the calendar with a Meet link that is in the confirmation email and invite; reschedule updates, cancel deletes', async () => {
    await connect('google');
    const campaign = await createBookingCampaign(testPool(), org.orgId, {}, { location_type: 'google_meet', location_details: '' });
    google.meetPendingPolls = 1; // Meet link arrives on the first poll
    const app = await buildApp(deps());
    const { appointmentId } = await bookAndConfirm(app, testPool(), org.orgId, campaign, { phone: phone(), email: 'ada@example.com', mailer });

    const [eventId, ev] = [...google.events.entries()][0]!;
    expect(ev.input.attendees.map((a) => a.email)).toEqual(['ada@example.com', 'jordan@acme.test']);
    expect(ev.input.meetRequestId).toBe(`appt-${appointmentId}`);
    expect(ev.sendUpdates).toBe('none'); // our own email goes out
    const meet = `https://meet.google.com/${eventId.slice(0, 3)}-abcd-efg`;
    const confirmation = mailer.sent.find((m) => m.to === 'ada@example.com')!;
    expect(confirmation.text).toContain(`Join Google Meet: ${meet}`);
    expect(confirmation.html).toContain(meet);
    expect(confirmation.icalEvent!.content).toContain(`LOCATION:${meet}`);

    const h = bearerFor(org.ownerId);
    const detail = (await app.inject({ method: 'GET', url: `/api/appointments/${appointmentId}`, headers: h })).json();
    expect(detail.meeting).toMatchObject({ provider: 'google_meet', join_url: meet, status: 'synced', calendar: true });

    const slots = (await app.inject({ method: 'GET', url: `/api/appointments/${appointmentId}/slots`, headers: h })).json();
    const next = slots[3];
    const start = next.startUtc ?? next.start_utc;
    const res = await app.inject({ method: 'POST', url: `/api/appointments/${appointmentId}/reschedule`, headers: h, payload: { start_utc: new Date(start).toISOString(), host_id: next.hostId ?? next.host_id } });
    expect(res.statusCode, res.body).toBe(200);
    expect(google.events.size).toBe(1);
    expect(google.events.get(eventId)!.input.start.toISOString()).toBe(new Date(start).toISOString());

    await app.inject({ method: 'POST', url: `/api/appointments/${appointmentId}/cancel`, headers: h, payload: {} });
    expect(google.deleted).toEqual([eventId]);
  });

  it('Zoom: creates the meeting, puts the link on the calendar event and in the email', async () => {
    await connect('google');
    await connect('zoom');
    const campaign = await createBookingCampaign(testPool(), org.orgId, {}, { location_type: 'zoom', location_details: '' });
    const app = await buildApp(deps());
    const { appointmentId } = await bookAndConfirm(app, testPool(), org.orgId, campaign, { phone: phone(), email: 'grace@example.com', mailer });
    const [zoomId, m] = [...zoom.meetings.entries()][0]!;
    expect(m.durationMinutes).toBe(30);
    expect(m.timeZone).toBe('America/New_York');
    const ev = [...google.events.values()][0]!;
    expect(ev.input.location).toBe(`https://zoom.us/j/${zoomId}`);
    expect(ev.input.meetRequestId).toBeUndefined();
    expect(mailer.sent.find((x) => x.to === 'grace@example.com')!.text).toContain(`Join Zoom meeting: https://zoom.us/j/${zoomId}`);

    const h = bearerFor(org.ownerId);
    await app.inject({ method: 'POST', url: `/api/appointments/${appointmentId}/cancel`, headers: h, payload: {} });
    expect(zoom.deleted).toEqual([zoomId]);
  });

  it('persists rotated Zoom refresh tokens', async () => {
    await connect('zoom');
    await accessTokenFor(deps(), org.orgId, 'zoom'); // cached from connect, no refresh
    clearTokenCache();
    await accessTokenFor(deps(), org.orgId, 'zoom');
    clearTokenCache();
    await accessTokenFor(deps(), org.orgId, 'zoom');
    expect(zoom.refreshTokensSeen).toEqual(['zoom-r', 'z-refresh-rot1']);
  });

  it('without the account connected, the email still goes out and admins are told what to fix', async () => {
    const campaign = await createBookingCampaign(testPool(), org.orgId, {}, { location_type: 'google_meet', location_details: '' });
    const app = await buildApp(deps());
    const { appointmentId } = await bookAndConfirm(app, testPool(), org.orgId, campaign, { phone: phone(), email: 'linus@example.com', mailer });
    expect(mailer.sent.find((x) => x.to === 'linus@example.com')!.text).toContain('Google Meet (the link will be emailed to you)');
    const { rows } = await testPool().query('select status, last_error from appointment_meetings where appointment_id = $1', [appointmentId]);
    expect(rows[0]).toMatchObject({ status: 'failed' });
    expect(rows[0].last_error).toContain('Settings → Integrations');
    const notes = await testPool().query("select title from in_app_notifications where organization_id = $1 and type = 'meeting_setup'", [org.orgId]);
    expect(notes.rowCount).toBe(1);
  });

  it('a temporary provider outage holds the email for a retry instead of sending it without the link', async () => {
    await connect('zoom');
    zoom.failTimes = 100; // outage lasts through the booking and the first email attempts
    const campaign = await createBookingCampaign(testPool(), org.orgId, {}, { location_type: 'zoom', location_details: '' });
    const app = await buildApp(deps());
    await expect(bookAndConfirm(app, testPool(), org.orgId, campaign, { phone: phone(), email: 'ken@example.com', mailer })).rejects.toThrow('no confirmation email');
    expect(mailer.sent.some((x) => x.to === 'ken@example.com')).toBe(false);
    zoom.failTimes = 0;
    // The retry (job) succeeds and the email carries the link.
    const { dispatchNotificationsBatch } = await import('../appointments/notifications/dispatcher');
    await testPool().query("update appointment_notifications set next_attempt_at = now() - interval '1 minute' where organization_id = $1", [org.orgId]);
    await dispatchNotificationsBatch(deps(), { organizationId: org.orgId });
    const sent = mailer.sent.find((x) => x.to === 'ken@example.com');
    expect(sent?.text).toMatch(/Join Zoom meeting: https:\/\/zoom\.us\/j\/\d+/);
  });
});
