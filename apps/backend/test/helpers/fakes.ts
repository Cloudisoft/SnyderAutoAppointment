import { randomUUID } from 'node:crypto';
import type { CartesiaClient } from '../../src/integrations/cartesia';
import type { GoogleClient, GoogleEvent, GoogleEventInput, SendUpdates } from '../../src/integrations/google';
import type { ZoomClient, ZoomMeetingInput } from '../../src/integrations/zoom';
import type { Mailer, OutgoingEmail, SmtpSettings } from '../../src/integrations/mailer';
import type { CallExtraction, OpenAiClient } from '../../src/integrations/openai';
import type { TwilioClient } from '../../src/integrations/twilio';
import type { VapiAssistant, VapiCall, VapiCallRequest, VapiClient, VapiControl } from '../../src/integrations/vapi';
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
    return { id, status: 'queued', monitor: { listenUrl: `wss://listen.test/${id}`, controlUrl: `https://control.test/${id}` } };
  }
  controls: { url: string; command: VapiControl }[] = [];
  async controlCall(url: string, command: VapiControl) {
    this.controls.push({ url, command });
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
  createdAssistants: VapiAssistant[] = [];
  deletedAssistants: string[] = [];
  /** When set, createAssistant rejects with this Vapi validation message. */
  rejectAssistant: string | null = null;
  async createAssistant(a: VapiAssistant) {
    if (this.rejectAssistant) throw new UpstreamError('Vapi', 400, JSON.stringify({ message: [this.rejectAssistant] }));
    this.createdAssistants.push(a);
    return { id: `asst_${randomUUID()}` };
  }
  async deleteAssistant(id: string) {
    this.deletedAssistants.push(id);
  }
  pingError: Error | null = null;
  async ping() {
    if (this.pingError) throw this.pingError;
  }
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

export class FakeMailer implements Mailer {
  configured = true;
  sent: OutgoingEmail[] = [];
  /** Errors to throw on the next sends (one per send). */
  failures: Error[] = [];
  /** Errors to throw for a specific recipient (one per send to that address). */
  failuresFor: Record<string, Error[]> = {};
  verified: SmtpSettings[] = [];
  verifyError: Error | null = null;
  async verify(settings: SmtpSettings) {
    this.verified.push(settings);
    if (this.verifyError) throw this.verifyError;
  }
  async settingsFor() {
    return { transport: 'smtp' as const, host: 'smtp.test', port: 587, secure: false, username: null, password: null, fromEmail: 'noreply@acme.test', fromName: null, replyTo: null };
  }
  async send(email: OutgoingEmail) {
    const f = this.failuresFor[email.to]?.shift() ?? this.failures.shift();
    if (f) throw f;
    this.sent.push(email);
    return { messageId: `<msg-${this.sent.length}@test>` };
  }
}

/** In-memory Google OAuth + Calendar. Records every call for assertions. */
export class FakeGoogle implements GoogleClient {
  events = new Map<string, { input: GoogleEventInput; sendUpdates: SendUpdates }>();
  deleted: string[] = [];
  refreshes = 0;
  failNext: Error | null = null;
  /** When set, new Meet links stay "pending" until getEvent is called this many times. */
  meetPendingPolls = 0;
  private polls = new Map<string, number>();
  configured() {
    return true;
  }
  authorizeUrl(redirectUri: string, state: string) {
    return `https://accounts.google.test/auth?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string) {
    return { accessToken: `g-access-${code}`, refreshToken: `g-refresh-${code}`, expiresIn: 3600 };
  }
  async refresh() {
    this.refreshes++;
    return { accessToken: `g-access-r${this.refreshes}`, expiresIn: 3600 };
  }
  async account() {
    return { email: 'calendar@acme.test', name: 'Acme Calendar' };
  }
  async revoke() {}
  private take() {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
  }
  private result(id: string): GoogleEvent {
    const e = this.events.get(id)!;
    const pending = !!e.input.meetRequestId && (this.polls.get(id) ?? 0) < this.meetPendingPolls;
    return { id, meetUrl: e.input.meetRequestId && !pending ? `https://meet.google.com/${id.slice(0, 3)}-abcd-efg` : null, meetPending: pending };
  }
  async insertEvent(_t: string, input: GoogleEventInput, sendUpdates: SendUpdates) {
    this.take();
    const id = `evt${this.events.size + 1}${randomUUID().slice(0, 6)}`;
    this.events.set(id, { input, sendUpdates });
    return this.result(id);
  }
  async patchEvent(_t: string, id: string, input: GoogleEventInput, sendUpdates: SendUpdates) {
    this.take();
    this.events.set(id, { input, sendUpdates });
    return this.result(id);
  }
  async getEvent(_t: string, id: string) {
    this.polls.set(id, (this.polls.get(id) ?? 0) + 1);
    return this.result(id);
  }
  async deleteEvent(_t: string, id: string) {
    this.take();
    this.deleted.push(id);
    this.events.delete(id);
  }
}

/** In-memory Zoom OAuth + meetings. Refresh rotates the refresh token like Zoom does. */
export class FakeZoom implements ZoomClient {
  meetings = new Map<string, ZoomMeetingInput>();
  deleted: string[] = [];
  refreshTokensSeen: string[] = [];
  failNext: Error | null = null;
  /** Number of upcoming createMeeting calls that fail with a 503. */
  failTimes = 0;
  configured() {
    return true;
  }
  authorizeUrl(redirectUri: string, state: string) {
    return `https://zoom.test/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
  }
  async exchangeCode(code: string) {
    return { accessToken: `z-access-${code}`, refreshToken: `z-refresh-${code}`, expiresIn: 3600 };
  }
  async refresh(refreshToken: string) {
    this.refreshTokensSeen.push(refreshToken);
    return { accessToken: `z-access-${this.refreshTokensSeen.length}`, refreshToken: `z-refresh-rot${this.refreshTokensSeen.length}`, expiresIn: 3600 };
  }
  async account() {
    return { email: 'host@acme.test', name: 'Acme Host' };
  }
  async revoke() {}
  async createMeeting(_t: string, m: ZoomMeetingInput) {
    if (this.failTimes > 0) {
      this.failTimes--;
      throw new UpstreamError('Zoom', 503, 'unavailable');
    }
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = null;
      throw e;
    }
    const id = String(80000000000 + this.meetings.size + 1);
    this.meetings.set(id, m);
    return { id, joinUrl: `https://zoom.us/j/${id}` };
  }
  async updateMeeting(_t: string, id: string, m: ZoomMeetingInput) {
    this.meetings.set(id, m);
  }
  async deleteMeeting(_t: string, id: string) {
    this.deleted.push(id);
    this.meetings.delete(id);
  }
}
