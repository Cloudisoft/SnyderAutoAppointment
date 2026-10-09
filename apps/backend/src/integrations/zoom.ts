import { DateTime } from 'luxon';
import { fetchJson, UpstreamError } from '../lib/http';
import { toTokens, type OAuthProviderClient } from './oauth';

export interface ZoomMeetingInput {
  topic: string;
  agenda: string;
  start: Date;
  durationMinutes: number;
  timeZone: string;
}

export interface ZoomClient extends OAuthProviderClient {
  createMeeting(accessToken: string, m: ZoomMeetingInput): Promise<{ id: string; joinUrl: string }>;
  updateMeeting(accessToken: string, id: string, m: ZoomMeetingInput): Promise<void>;
  deleteMeeting(accessToken: string, id: string): Promise<void>;
}

const API = 'https://api.zoom.us/v2';

function meetingBody(m: ZoomMeetingInput) {
  return {
    topic: m.topic.slice(0, 200),
    agenda: m.agenda.slice(0, 2000),
    type: 2, // scheduled
    start_time: DateTime.fromJSDate(m.start, { zone: m.timeZone }).toFormat("yyyy-LL-dd'T'HH:mm:ss"),
    timezone: m.timeZone,
    duration: m.durationMinutes,
    settings: { join_before_host: true, waiting_room: false, mute_upon_entry: false },
  };
}

export function createZoomClient(clientId: string, clientSecret: string): ZoomClient {
  const basic = () => `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
  const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
  const tokenCall = (params: Record<string, string>) =>
    fetchJson<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string }>('Zoom', 'https://zoom.us/oauth/token', {
      method: 'POST',
      headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
  return {
    configured: () => !!clientId && !!clientSecret,
    authorizeUrl(redirectUri, state) {
      return `https://zoom.us/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state })}`;
    },
    async exchangeCode(code, redirectUri) {
      return toTokens(await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }));
    },
    async refresh(refreshToken) {
      return toTokens(await tokenCall({ grant_type: 'refresh_token', refresh_token: refreshToken }));
    },
    async account(accessToken) {
      const r = await fetchJson<{ email: string; first_name?: string; last_name?: string }>('Zoom', `${API}/users/me`, { headers: auth(accessToken) });
      return { email: r.email, name: [r.first_name, r.last_name].filter(Boolean).join(' ') || undefined };
    },
    async revoke(token) {
      await fetchJson('Zoom', 'https://zoom.us/oauth/revoke', {
        method: 'POST',
        headers: { authorization: basic(), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }).toString(),
      }).catch(() => undefined);
    },
    async createMeeting(accessToken, m) {
      const r = await fetchJson<{ id: number | string; join_url: string }>('Zoom', `${API}/users/me/meetings`, {
        method: 'POST',
        headers: auth(accessToken),
        body: JSON.stringify(meetingBody(m)),
      });
      return { id: String(r.id), joinUrl: r.join_url };
    },
    async updateMeeting(accessToken, id, m) {
      await fetchJson('Zoom', `${API}/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', headers: auth(accessToken), body: JSON.stringify(meetingBody(m)) });
    },
    async deleteMeeting(accessToken, id) {
      try {
        await fetchJson('Zoom', `${API}/meetings/${encodeURIComponent(id)}`, { method: 'DELETE', headers: auth(accessToken) });
      } catch (err) {
        if (err instanceof UpstreamError && err.status === 404) return;
        throw err;
      }
    },
  };
}
