import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { createAgent, createCall, createLead, createPublishedCampaign, createVoice } from '../../../test/helpers/fixtures';

let n = 0;
const phone = () => `+1212555${String(1000 + ++n).slice(-4)}`;

describeDb('bulk actions and exports', () => {
  let org: SeededOrg;
  let other: SeededOrg;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    other = await seedOrg(testPool());
  });
  afterAll(closeTestPool);

  const post = async (url: string, payload: unknown, user = org.ownerId) => {
    const app = await buildApp(testDeps());
    return app.inject({ method: 'POST', url, headers: bearerFor(user), payload: payload as object });
  };

  it('moves, removes, re-statuses and deletes selected leads, scoped to the organization', async () => {
    const db = testPool();
    const list = (await db.query<{ id: string }>("insert into lead_lists(organization_id, name) values ($1, 'Target') returning id", [org.orgId])).rows[0]!.id;
    const a = await createLead(db, org.orgId, { phone_e164: phone() });
    const b = await createLead(db, org.orgId, { phone_e164: phone() });
    const foreign = await createLead(db, other.orgId, { phone_e164: phone() });

    const moved = await post('/api/leads/bulk', { action: 'move_to_list', selection: { ids: [a, b, foreign] }, lead_list_id: list });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ affected: 2, message: 'Moved 2 leads to Target' });
    const foreignRow = await db.query('select lead_list_id from leads where id = $1', [foreign]);
    expect(foreignRow.rows[0].lead_list_id).toBeNull();

    const dnc = await post('/api/leads/bulk', { action: 'set_status', selection: { ids: [a] }, status: 'do_not_call' });
    expect(dnc.json().affected).toBe(1);
    const dncRow = await db.query('select 1 from dnc_numbers d join leads l on l.phone_e164 = d.phone_e164 where l.id = $1', [a]);
    expect(dncRow.rowCount).toBe(1);

    const removed = await post('/api/leads/bulk', { action: 'remove_from_list', selection: { filter: { list_id: list } } });
    expect(removed.json().affected).toBe(2);

    const del = await post('/api/leads/bulk', { action: 'delete', selection: { ids: [a, b] } });
    expect(del.json()).toMatchObject({ affected: 2, skipped: 0 });
  });

  it('adds leads to a campaign, skipping do-not-call, and removes queued ones', async () => {
    const db = testPool();
    const { campaignId } = await createPublishedCampaign(db, org.orgId);
    const ok = await createLead(db, org.orgId, { phone_e164: phone() });
    const blocked = await createLead(db, org.orgId, { phone_e164: phone() });
    await db.query("update leads set status = 'do_not_call' where id = $1", [blocked]);

    const added = await post('/api/leads/bulk', { action: 'add_to_campaign', selection: { ids: [ok, blocked] }, campaign_id: campaignId });
    expect(added.json()).toMatchObject({ affected: 1, skipped: 1 });
    const removed = await post('/api/leads/bulk', { action: 'remove_from_campaign', selection: { ids: [ok] }, campaign_id: campaignId });
    expect(removed.json().affected).toBe(1);
    const state = await db.query('select state from campaign_leads where lead_id = $1', [ok]);
    expect(state.rows[0].state).toBe('removed');
    // Re-adding a removed lead queues it again.
    const readded = await post('/api/leads/bulk', { action: 'add_to_campaign', selection: { ids: [ok] }, campaign_id: campaignId });
    expect(readded.json().affected).toBe(1);
  });

  it('never deletes a lead or call that is on a live call; deletes finished calls', async () => {
    const db = testPool();
    const { campaignId, versionId } = await createPublishedCampaign(db, org.orgId);
    const live = await createLead(db, org.orgId, { phone_e164: phone() });
    const done = await createLead(db, org.orgId, { phone_e164: phone() });
    const liveCall = await createCall(db, org.orgId, { campaignId, versionId, leadId: live });
    const doneCall = await createCall(db, org.orgId, { campaignId, versionId, leadId: done });
    await db.query("update calls set status = 'ended', end_processed_at = now() where id = $1", [doneCall.callId]);

    const del = await post('/api/leads/bulk', { action: 'delete', selection: { ids: [live] } });
    expect(del.json()).toMatchObject({ affected: 0, skipped: 1 });

    const calls = await post('/api/calls/bulk-delete', { ids: [liveCall.callId, doneCall.callId] });
    expect(calls.json()).toMatchObject({ affected: 1, skipped: 1 });
    expect((await db.query('select 1 from calls where id = $1', [liveCall.callId])).rowCount).toBe(1);

    const viewer = await org.addUser('viewer');
    const forbidden = await post('/api/calls/bulk-delete', { ids: [liveCall.callId] }, viewer);
    expect(forbidden.statusCode).toBe(403);
  });

  it('deletes lists with or without their leads', async () => {
    const db = testPool();
    const mk = async (name: string) => (await db.query<{ id: string }>('insert into lead_lists(organization_id, name) values ($1, $2) returning id', [org.orgId, name])).rows[0]!.id;
    const keep = await mk('Keep leads');
    const purge = await mk('Purge leads');
    const l1 = await createLead(db, org.orgId, { phone_e164: phone() });
    const l2 = await createLead(db, org.orgId, { phone_e164: phone() });
    await db.query('update leads set lead_list_id = $2 where id = $1', [l1, keep]);
    await db.query('update leads set lead_list_id = $2 where id = $1', [l2, purge]);

    expect((await post('/api/lead-lists/bulk-delete', { ids: [keep] })).json().affected).toBe(1);
    expect((await db.query('select 1 from leads where id = $1', [l1])).rowCount).toBe(1);
    const res = await post('/api/lead-lists/bulk-delete', { ids: [purge], delete_leads: true });
    expect(res.json().message).toContain('1 leads deleted');
    expect((await db.query('select 1 from leads where id = $1', [l2])).rowCount).toBe(0);
  });

  it('bulk deactivates voices and refuses to delete one an agent uses', async () => {
    const db = testPool();
    const spare = await createVoice(db, org.orgId, 'Spare');
    const agentId = await createAgent(db, org.orgId, { voiceName: 'InUse' });
    const voiceId = (await db.query<{ voice_id: string }>('select voice_id from agents where id = $1', [agentId])).rows[0]!.voice_id;
    const off = await post('/api/voices/bulk', { ids: [spare, voiceId], action: 'deactivate' });
    expect(off.json().affected).toBe(2);
    const del = await post('/api/voices/bulk', { ids: [spare, voiceId], action: 'delete' });
    expect(del.json()).toMatchObject({ affected: 1, skipped: 1 });
  });

  it('exports call records and leads as CSV and Excel with recordings and transcripts', async () => {
    const db = testPool();
    const { campaignId, versionId } = await createPublishedCampaign(db, org.orgId);
    const lead = await createLead(db, org.orgId, { phone_e164: phone(), custom_fields: { plan_tier: '=gold' } });
    const { callId } = await createCall(db, org.orgId, { campaignId, versionId, leadId: lead });
    await db.query(
      "update calls set status='ended', end_processed_at=now(), transcript='AI: Hi\nUser: Hello', recording_url='https://rec.example/1.wav', summary='Booked' where id=$1",
      [callId],
    );
    const app = await buildApp(testDeps());
    const csv = await app.inject({ method: 'GET', url: `/api/calls/export?format=csv&ids=${callId}`, headers: bearerFor(org.ownerId) });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-disposition']).toMatch(/call-records-.*\.csv/);
    expect(csv.body).toContain('https://rec.example/1.wav');
    expect(csv.body).toContain('"AI: Hi\nUser: Hello"');
    expect(csv.body.trim().split('\r\n')).toHaveLength(2); // header + one record (transcript newlines stay quoted)

    const xlsx = await app.inject({ method: 'GET', url: '/api/calls/export?format=xlsx', headers: bearerFor(org.ownerId) });
    expect(xlsx.statusCode).toBe(200);
    expect(xlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');

    const leads = await app.inject({ method: 'GET', url: '/api/leads/export?format=csv', headers: bearerFor(org.ownerId) });
    expect(leads.statusCode).toBe(200);
    expect(leads.body).toContain('plan_tier');
    expect(leads.body).toContain("'=gold"); // formula injection guard
    expect(leads.body).toContain('Booked');
    const leadsXlsx = await app.inject({ method: 'GET', url: '/api/leads/export?format=xlsx', headers: bearerFor(org.ownerId) });
    expect(leadsXlsx.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });
});
