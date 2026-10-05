import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { testDeps } from '../../../test/helpers/deps';
import { FakeVapi } from '../../../test/helpers/fakes';
import { createLead, createPublishedCampaign } from '../../../test/helpers/fixtures';
import { fixedClock } from '../../lib/clock';
import { createCallPipeline } from '../calls/pipeline';
import { dialerTick } from './dialer';
import { inCallingWindow } from './window';

describe('calling window', () => {
  const w = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  it('evaluates in the lead time zone', () => {
    // 2026-10-12 is a Monday. 14:00Z = 10:00 New York, 07:00 Los Angeles.
    const now = new Date('2026-10-12T14:00:00Z');
    expect(inCallingWindow(now, 'America/New_York', w)).toBe(true);
    expect(inCallingWindow(now, 'America/Los_Angeles', w)).toBe(false);
    expect(inCallingWindow(new Date('2026-10-11T15:00:00Z'), 'America/New_York', w)).toBe(false); // Sunday
  });
});

describeDb('dialer', () => {
  let org: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  it('respects concurrency, the worker lease and skips DNC leads', async () => {
    const db = testPool();
    const { campaignId } = await createPublishedCampaign(db, org.orgId, { concurrency: 2 });
    const leads = await Promise.all([0, 1, 2].map((i) => createLead(db, org.orgId, { phone_e164: `+1212555030${i}` })));
    const dncLead = await createLead(db, org.orgId, { phone_e164: '+12125550309' });
    await db.query(`insert into dnc_numbers(organization_id, phone_e164) values ($1, '+12125550309')`, [org.orgId]);
    for (const l of [...leads, dncLead]) {
      await db.query('insert into campaign_leads(organization_id, campaign_id, lead_id) values ($1, $2, $3)', [org.orgId, campaignId, l]);
    }
    const vapi = new FakeVapi();
    const deps = testDeps({ vapi, clock: fixedClock(new Date()) });
    await db.query(`delete from worker_leases where name = 'dialer'`);

    expect((await dialerTick(deps, createCallPipeline(), 'other-holder')).dialed).toBeGreaterThanOrEqual(0);
    // "other-holder" now owns the lease; a second instance must not dial.
    expect((await dialerTick(deps, createCallPipeline(), 'me')).dialed).toBe(0);
    await db.query(`delete from worker_leases where name = 'dialer'`);

    const { rows } = await db.query(
      `select count(*)::int as n from calls where campaign_id = $1`, [campaignId]);
    expect(rows[0].n).toBe(2);
    const dialed = vapi.calls.filter((c) => c.metadata.organizationId === org.orgId);
    expect(dialed.map((c) => c.customer.number)).not.toContain('+12125550309');
    const { rows: dnc } = await db.query(`select state from campaign_leads where lead_id = $1`, [dncLead]);
    expect(dnc[0].state).toBe('done');
  });

  it('a failed Vapi request finalizes the call as failed and queues a retry', async () => {
    const db = testPool();
    const { campaignId } = await createPublishedCampaign(db, org.orgId, { concurrency: 1 });
    const leadId = await createLead(db, org.orgId, { phone_e164: '+12125550401' });
    await db.query('insert into campaign_leads(organization_id, campaign_id, lead_id) values ($1, $2, $3)', [org.orgId, campaignId, leadId]);
    const vapi = new FakeVapi();
    vapi.failNext = new Error('network down');
    // Pause the other campaigns so only this one dials.
    await db.query(`update campaigns set status = 'paused' where organization_id = $1 and id <> $2`, [org.orgId, campaignId]);
    await db.query(`delete from worker_leases where name = 'dialer'`);
    await dialerTick(testDeps({ vapi, clock: fixedClock(new Date()) }), createCallPipeline(), 'me');
    const { rows } = await db.query(
      `select c.status, c.disposition_key, cl.state from calls c join campaign_leads cl on cl.id = c.campaign_lead_id where c.lead_id = $1`,
      [leadId],
    );
    expect(rows[0]).toEqual({ status: 'failed', disposition_key: 'failed', state: 'retry_wait' });
  });
});
