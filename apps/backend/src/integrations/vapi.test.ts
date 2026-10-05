import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../lib/errors';
import { createVapiClient } from './vapi';

const opts = { number: '+17864225823', twilioAccountSid: 'AC1', twilioAuthToken: 't', name: 'Main', serverUrl: 'https://x.test/webhooks/vapi', serverSecret: 's'.repeat(20) };
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe('importTwilioNumber', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reuses a number already imported into this account and points it at our server', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body as string | undefined });
      if (init.method === 'POST') return res(400, { message: 'Existing Phone Number 4cc740d4-cfd7-4f25-9a46-e8e1ebd9cec8 Has Identical `twilioAccountSid` AC1 and `number` +17864225823.' });
      return res(200, { id: '4cc740d4-cfd7-4f25-9a46-e8e1ebd9cec8' });
    });
    const r = await createVapiClient('key').importTwilioNumber(opts);
    expect(r.id).toBe('4cc740d4-cfd7-4f25-9a46-e8e1ebd9cec8');
    expect(calls[1]).toMatchObject({ method: 'PATCH', url: expect.stringContaining('/phone-number/4cc740d4') });
    expect(JSON.parse(calls[1]!.body!)).toMatchObject({ server: { url: opts.serverUrl } });
  });

  it('finds the existing number by listing when the error has no id', async () => {
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (init.method === 'POST') return res(400, { message: 'number already exists' });
      if ((init.method ?? 'GET') === 'GET') return res(200, [{ id: 'other', number: '+1999' }, { id: 'mine', number: opts.number }]);
      return res(200, { id: 'mine' });
    });
    expect((await createVapiClient('key').importTwilioNumber(opts)).id).toBe('mine');
  });

  it('explains a number that belongs to a different account without naming the vendor', async () => {
    vi.stubGlobal('fetch', async () => res(400, { message: 'Phone number +14067322198 already in use by another org.' }));
    const err = await createVapiClient('key').importTwilioNumber({ ...opts, number: '+14067322198' }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain('different calling account');
    expect(err.message).not.toMatch(/vapi/i);
  });
});
