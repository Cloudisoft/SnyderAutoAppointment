import { fetchJson } from '../lib/http';

export interface TwilioIncomingNumber {
  sid: string;
  phone_number: string;
  friendly_name: string;
}

export interface TwilioClient {
  verifyCredentials(accountSid: string, authToken: string): Promise<{ friendlyName: string }>;
  listIncomingNumbers(accountSid: string, authToken: string): Promise<TwilioIncomingNumber[]>;
}

const basic = (sid: string, token: string) => `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;

export function createTwilioClient(): TwilioClient {
  return {
    async verifyCredentials(accountSid, authToken) {
      const res = await fetchJson<{ friendly_name: string }>(
        'Twilio',
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`,
        { headers: { authorization: basic(accountSid, authToken) } },
      );
      return { friendlyName: res.friendly_name };
    },
    async listIncomingNumbers(accountSid, authToken) {
      const res = await fetchJson<{ incoming_phone_numbers: TwilioIncomingNumber[] }>(
        'Twilio',
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/IncomingPhoneNumbers.json?PageSize=200`,
        { headers: { authorization: basic(accountSid, authToken) } },
      );
      return res.incoming_phone_numbers.map((n) => ({
        sid: n.sid,
        phone_number: n.phone_number,
        friendly_name: n.friendly_name,
      }));
    },
  };
}
