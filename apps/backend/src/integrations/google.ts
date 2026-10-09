import { fetchJson, UpstreamError } from '../lib/http';
import { toTokens, type OAuthProviderClient } from './oauth';

export const GOOGLE_SCOPES = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/calendar.events'];

export interface GoogleEventInput {
  summary: string;
  description: string;
  location?: string;
  start: Date;
  end: Date;
  timeZone: string;
  attendees: { email: string; displayName?: string }[];
  /** Ask Google to create a Meet link for this event (idempotent per requestId). */
  meetRequestId?: string;
}

export interface GoogleEvent {
  id: string;
  meetUrl: string | null;
  /** Meet links are created asynchronously; true while Google is still creating it. */
  meetPending: boolean;
}

export type SendUpdates = 'all' | 'none';

export interface GoogleClient extends OAuthProviderClient {
  insertEvent(accessToken: string, e: GoogleEventInput, sendUpdates: SendUpdates): Promise<GoogleEvent>;
  patchEvent(accessToken: string, id: string, e: GoogleEventInput, sendUpdates: SendUpdates): Promise<GoogleEvent>;
  getEvent(accessToken: string, id: string): Promise<GoogleEvent>;
  deleteEvent(accessToken: string, id: string, sendUpdates: SendUpdates): Promise<void>;
}

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface RawEvent {
  id: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType: string; uri: string }[]; createRequest?: { status?: { statusCode?: string } } };
}

function toEvent(r: RawEvent): GoogleEvent {
  const video = r.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? r.hangoutLink ?? null;
  const status = r.conferenceData?.createRequest?.status?.statusCode;
  return { id: r.id, meetUrl: video, meetPending: !video && status === 'pending' };
}

function body(e: GoogleEventInput) {
  return {
    summary: e.summary,
    description: e.description,
    ...(e.location ? { location: e.location } : {}),
    start: { dateTime: e.start.toISOString(), timeZone: e.timeZone },
    end: { dateTime: e.end.toISOString(), timeZone: e.timeZone },
    attendees: e.attendees,
    reminders: { useDefault: true },
    ...(e.meetRequestId ? { conferenceData: { createRequest: { requestId: e.meetRequestId, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
  };
}

export function createGoogleClient(clientId: string, clientSecret: string): GoogleClient {
  const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const form = (params: Record<string, string>) => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  return {
    configured: () => !!clientId && !!clientSecret,
    authorizeUrl(redirectUri, state) {
      const q = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: GOOGLE_SCOPES.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    },
    async exchangeCode(code, redirectUri) {
      return toTokens(
        await fetchJson('Google', 'https://oauth2.googleapis.com/token', form({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret })),
      );
    },
    async refresh(refreshToken) {
      return toTokens(
        await fetchJson('Google', 'https://oauth2.googleapis.com/token', form({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret })),
      );
    },
    async account(accessToken) {
      const r = await fetchJson<{ email: string; name?: string }>('Google', 'https://openidconnect.googleapis.com/v1/userinfo', { headers: auth(accessToken) });
      return { email: r.email, name: r.name };
    },
    async revoke(token) {
      await fetchJson('Google', `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => undefined);
    },
    async insertEvent(accessToken, e, sendUpdates) {
      const r = await fetchJson<RawEvent>('Google', `${CAL}?conferenceDataVersion=1&sendUpdates=${sendUpdates}`, {
        method: 'POST',
        headers: auth(accessToken),
        body: JSON.stringify(body(e)),
      });
      return toEvent(r);
    },
    async patchEvent(accessToken, id, e, sendUpdates) {
      const r = await fetchJson<RawEvent>('Google', `${CAL}/${encodeURIComponent(id)}?conferenceDataVersion=1&sendUpdates=${sendUpdates}`, {
        method: 'PATCH',
        headers: auth(accessToken),
        body: JSON.stringify(body(e)),
      });
      return toEvent(r);
    },
    async getEvent(accessToken, id) {
      return toEvent(await fetchJson<RawEvent>('Google', `${CAL}/${encodeURIComponent(id)}`, { headers: auth(accessToken) }));
    },
    async deleteEvent(accessToken, id, sendUpdates) {
      try {
        await fetchJson('Google', `${CAL}/${encodeURIComponent(id)}?sendUpdates=${sendUpdates}`, { method: 'DELETE', headers: auth(accessToken) });
      } catch (err) {
        // Already gone counts as deleted.
        if (err instanceof UpstreamError && (err.status === 404 || err.status === 410)) return;
        throw err;
      }
    },
  };
}
