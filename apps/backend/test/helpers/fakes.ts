import { randomUUID } from 'node:crypto';
import type { CartesiaClient } from '../../src/integrations/cartesia';
import type { CallExtraction, OpenAiClient } from '../../src/integrations/openai';
import type { TwilioClient } from '../../src/integrations/twilio';
import type { VapiCall, VapiCallRequest, VapiClient } from '../../src/integrations/vapi';
import { UpstreamError } from '../../src/lib/http';

export class FakeVapi implements VapiClient {
  calls: VapiCallRequest[] = [];
  remoteCalls = new Map<string, VapiCall>();
  importedNumbers: { number: string }[] = [];
  /** When set, createCall rejects payloads containing function tools with a 400 (simulates Vapi rejecting tools). */
  rejectFunctionTools = false;
  failNext: Error | null = null;

  async createCall(req: VapiCallRequest) {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    if (this.rejectFunctionTools && req.assistant.model.tools.some((t) => t.type === 'function' && t.function.name === 'book_appointment')) {
      throw new UpstreamError('Vapi', 400, '{"message":["assistant.model.tools.0.function is invalid"]}');
    }
    this.calls.push(req);
    const id = `vapi_${randomUUID()}`;
    this.remoteCalls.set(id, { id, status: 'queued', metadata: req.metadata });
    return { id, status: 'queued' };
  }
  async getCall(id: string) {
    const c = this.remoteCalls.get(id);
    if (!c) throw new UpstreamError('Vapi', 404, 'not found');
    return c;
  }
  async importTwilioNumber(o: { number: string }) {
    this.importedNumbers.push({ number: o.number });
    return { id: `pn_${randomUUID()}` };
  }
  async deletePhoneNumber() {}
}

export const fakeCartesia: CartesiaClient = {
  async listVoices() {
    return [{ id: 'cartesia-voice-1', name: 'Katie', language: 'en' }];
  },
};

export const fakeTwilio: TwilioClient = {
  async verifyCredentials() {
    return { friendlyName: 'Test' };
  },
  async listIncomingNumbers() {
    return [{ sid: 'PN1', phone_number: '+12125550100', friendly_name: 'Main' }];
  },
};

export class FakeOpenAi implements OpenAiClient {
  enabled = true;
  next: Partial<CallExtraction> = {};
  calls = 0;
  async extractCall() {
    this.calls++;
    return { summary: 'Prospect discussed the offer.', meeting_agreed: false, meeting_start: null, attendee_email: null, notes: null, ...this.next };
  }
}
