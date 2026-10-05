import formbody from '@fastify/formbody';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../../deps';
import { readSecret } from '../../../integrations/vault';
import { classifyInboundSms } from './sms';

export const TWILIO_SMS_WEBHOOK_PATH = '/webhooks/twilio/sms';

/** Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted key/value pairs)). */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  return createHmac('sha1', authToken).update(Buffer.from(data, 'utf8')).digest('base64');
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Inbound SMS (STOP/START opt-out handling) for the future SMS appointment channel. */
export async function registerTwilioSmsWebhook(app: FastifyInstance, deps: Deps) {
  await app.register(async (scope) => {
    await scope.register(formbody);
    scope.post(TWILIO_SMS_WEBHOOK_PATH, async (req, reply) => {
      const params = (req.body ?? {}) as Record<string, string>;
      const to = params.To ?? '';
      const from = params.From ?? '';
      const { rows } = await deps.db.query<{ organization_id: string; account_sid: string; auth_token_secret_id: string }>(
        `select p.organization_id, t.account_sid, t.auth_token_secret_id
           from phone_numbers p join twilio_accounts t on t.id = p.twilio_account_id where p.e164 = $1 limit 1`,
        [to],
      );
      const number = rows[0];
      const authToken = number ? await readSecret(deps.db, number.auth_token_secret_id) : deps.config.TWILIO_AUTH_TOKEN;
      const url = `${deps.config.BACKEND_PUBLIC_URL.replace(/\/$/, '')}${TWILIO_SMS_WEBHOOK_PATH}`;
      const sig = req.headers['x-twilio-signature'];
      if (!authToken || typeof sig !== 'string' || !safeEqual(sig, twilioSignature(authToken, url, params))) {
        req.log.warn('rejected Twilio webhook with invalid signature');
        return reply.status(403).send('Forbidden');
      }
      const action = classifyInboundSms(params.Body ?? '');
      if (number && from && action === 'stop') {
        await deps.db.query(
          `insert into sms_opt_outs(organization_id, phone_e164) values ($1, $2) on conflict (organization_id, phone_e164) do nothing`,
          [number.organization_id, from],
        );
      } else if (number && from && action === 'start') {
        await deps.db.query('delete from sms_opt_outs where organization_id = $1 and phone_e164 = $2', [number.organization_id, from]);
      }
      return reply.type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    });
  });
}
