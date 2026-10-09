import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { buildApp } from '../../app';
import { closeTestPool, describeDb, seedOrg, testPool, type SeededOrg } from '../../../test/helpers/db';
import { bearerFor, testDeps } from '../../../test/helpers/deps';
import { FakeVapi } from '../../../test/helpers/fakes';
import { createCall, createLead, createPublishedCampaign } from '../../../test/helpers/fixtures';

describeDb('call recordings', () => {
  let org: SeededOrg;
  let campaign: Awaited<ReturnType<typeof createPublishedCampaign>>;
  beforeAll(async () => {
    org = await seedOrg(testPool());
    campaign = await createPublishedCampaign(testPool(), org.orgId);
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(closeTestPool);

  async function endedCall(recordingUrl: string | null) {
    const leadId = await createLead(testPool(), org.orgId, { phone_e164: `+1415555${Math.floor(1000 + Math.random() * 8999)}` });
    const c = await createCall(testPool(), org.orgId, { ...campaign, leadId });
    await testPool().query("update calls set status = 'ended', connected = true, recording_url = $2 where id = $1", [c.callId, recordingUrl]);
    return c;
  }

  /** Storage that only serves the fresh presigned URL; the stored one has expired. */
  function stubStorage() {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      requested.push(url);
      if (url.startsWith('https://storage.test/fresh')) {
        const range = (init?.headers as Record<string, string> | undefined)?.range;
        return new Response(range ? 'R' : 'RIFFwavdata', { status: range ? 206 : 200, headers: { 'content-type': 'audio/wav' } });
      }
      return new Response('expired', { status: 403 });
    });
    return requested;
  }

  it('streams the recording, refreshing an expired storage link from the calling service', async () => {
    const vapi = new FakeVapi();
    const app = await buildApp(testDeps({ vapi }));
    const { callId, vapiCallId } = await endedCall('https://storage.test/expired.wav');
    vapi.remoteCalls.set(vapiCallId, { id: vapiCallId, status: 'ended', artifact: { presignedMonoUrl: 'https://storage.test/fresh.wav' } });
    stubStorage();

    const link = (await app.inject({ method: 'GET', url: `/api/calls/${callId}/recording-link`, headers: bearerFor(org.ownerId) })).json().url as string;
    expect(link).toMatch(/^https:\/\/api\.example\.test\/api\/recordings\/.+\?exp=\d+&sig=/);
    const path = link.replace('https://api.example.test', '');
    const audio = await app.inject({ method: 'GET', url: path });
    expect(audio.statusCode).toBe(200);
    expect(audio.headers['content-type']).toBe('audio/wav');
    expect(audio.body).toBe('RIFFwavdata');
    const { rows } = await testPool().query('select recording_url from calls where id = $1', [callId]);
    expect(rows[0].recording_url).toBe('https://storage.test/fresh.wav');
    expect((await app.inject({ method: 'GET', url: `${path}&download=1` })).headers['content-disposition']).toContain('attachment');
  });

  it('rejects tampered or expired links and other organizations', async () => {
    const app = await buildApp(testDeps());
    const { callId } = await endedCall('https://storage.test/fresh.wav');
    stubStorage();
    const link = (await app.inject({ method: 'GET', url: `/api/calls/${callId}/recording-link`, headers: bearerFor(org.ownerId) })).json().url as string;
    const path = link.replace('https://api.example.test', '');
    expect((await app.inject({ method: 'GET', url: path.replace(/sig=.{4}/, 'sig=AAAA') })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: path.replace(/exp=\d+/, 'exp=1000') })).statusCode).toBe(403);
    const other = await seedOrg(testPool());
    expect((await app.inject({ method: 'GET', url: `/api/calls/${callId}/recording-link`, headers: bearerFor(other.ownerId) })).statusCode).toBe(404);
  });

  it('reports a missing recording clearly', async () => {
    const app = await buildApp(testDeps());
    const { callId } = await endedCall(null);
    stubStorage();
    const link = (await app.inject({ method: 'GET', url: `/api/calls/${callId}/recording-link`, headers: bearerFor(org.ownerId) })).json().url as string;
    const res = await app.inject({ method: 'GET', url: link.replace('https://api.example.test', '') });
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toContain('No recording');
  });
});
