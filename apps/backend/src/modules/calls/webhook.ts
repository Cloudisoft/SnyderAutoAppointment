import type { FastifyInstance } from 'fastify';
import type { Deps } from '../../deps';
import { verifyVapiSecret } from '../../plugins/vapiAuth';
import { VAPI_WEBHOOK_PATH } from '../agents/assistantBuilder';
import { addCallEvent } from './events';
import { fromEndOfCallReport } from './normalize';
import { handleCallEnded, type CallPipeline } from './pipeline';
import { executeToolCall, GENERIC_TOOL_FALLBACK } from './tools';
import type { CallRow } from './types';

interface VapiServerMessage {
  type: string;
  call?: { id: string; metadata?: Record<string, string>; assistantOverrides?: { metadata?: Record<string, string> } };
  assistant?: { metadata?: Record<string, string> };
  status?: string;
  role?: string;
  transcript?: string;
  transcriptType?: string;
  toolCallList?: { id: string; type?: string; function: { name: string; arguments: unknown } }[];
  toolWithToolCallList?: { toolCall: { id: string; function: { name: string; arguments: unknown } } }[];
  [k: string]: unknown;
}

async function findCall(deps: Deps, msg: VapiServerMessage): Promise<CallRow | null> {
  const ourId = msg.call?.metadata?.callId ?? msg.assistant?.metadata?.callId ?? msg.call?.assistantOverrides?.metadata?.callId;
  const uuidRe = /^[0-9a-f-]{36}$/i;
  const { rows } = await deps.db.query<CallRow>(
    `select * from calls where ($1::uuid is not null and id = $1::uuid) or ($2::text is not null and vapi_call_id = $2) limit 1`,
    [ourId && uuidRe.test(ourId) ? ourId : null, msg.call?.id ?? null],
  );
  return rows[0] ?? null;
}

const STATUS_MAP: Record<string, string> = { queued: 'queued', ringing: 'ringing', 'in-progress': 'in_progress', forwarding: 'in_progress' };

export async function registerVapiWebhook(app: FastifyInstance, deps: Deps, pipeline: CallPipeline) {
  app.post(VAPI_WEBHOOK_PATH, { preHandler: [verifyVapiSecret(deps.config.VAPI_WEBHOOK_SECRET)] }, async (req, reply) => {
    const msg = (req.body as { message?: VapiServerMessage } | undefined)?.message;
    if (!msg?.type) return reply.send({});

    switch (msg.type) {
      case 'tool-calls': {
        const list =
          msg.toolCallList ??
          msg.toolWithToolCallList?.map((t) => ({ id: t.toolCall.id, function: t.toolCall.function })) ??
          [];
        // Tool failures must never break the call: everything below resolves to a spoken result.
        let call: CallRow | null = null;
        try {
          call = await findCall(deps, msg);
        } catch (err) {
          req.log.error({ err }, 'VAPI TOOL FAILED: call lookup error');
        }
        const results = await Promise.all(
          list.map((tc) =>
            executeToolCall(deps, pipeline.tools, call, { id: tc.id, name: tc.function.name, arguments: tc.function.arguments }).catch(
              (err) => {
                req.log.error({ err, tool: tc.function.name }, 'VAPI TOOL FAILED: executor error');
                return { toolCallId: tc.id, result: GENERIC_TOOL_FALLBACK };
              },
            ),
          ),
        );
        return reply.send({ results });
      }

      case 'status-update': {
        const call = await findCall(deps, msg);
        const status = msg.status ? STATUS_MAP[msg.status] : undefined;
        if (call && status && !call.end_processed_at) {
          await deps.db.query(
            `update calls set status = $2, vapi_call_id = coalesce(vapi_call_id, $3),
                    started_at = case when $2 = 'in_progress' then coalesce(started_at, now()) else started_at end
              where id = $1 and end_processed_at is null`,
            [call.id, status, msg.call?.id ?? null],
          );
          await addCallEvent(deps.db, { organizationId: call.organization_id, callId: call.id, type: 'status', content: status });
        }
        return reply.send({});
      }

      case 'transcript': {
        if (msg.transcriptType !== 'final' || !msg.transcript) return reply.send({});
        const call = await findCall(deps, msg);
        if (call) {
          await addCallEvent(deps.db, {
            organizationId: call.organization_id,
            callId: call.id,
            type: 'transcript',
            role: msg.role === 'assistant' ? 'assistant' : 'user',
            content: msg.transcript,
          });
        }
        return reply.send({});
      }

      // Live transfer to a human: flag the call and show it in the live monitor right away.
      case 'transfer-update': {
        const call = await findCall(deps, msg);
        if (call) {
          const dest = (msg.destination as { number?: string; message?: string } | undefined)?.number;
          await deps.db.query('update calls set transferred = true where id = $1', [call.id]);
          await addCallEvent(deps.db, {
            organizationId: call.organization_id,
            callId: call.id,
            type: 'status',
            content: dest ? `transferring to ${dest}` : 'transferring to a human',
          });
        }
        return reply.send({});
      }

      case 'end-of-call-report': {
        const data = fromEndOfCallReport(msg as Parameters<typeof fromEndOfCallReport>[0]);
        const call = await findCall(deps, msg);
        const result = await handleCallEnded(deps, pipeline, data, { callId: call?.id });
        if (result.status === 'unknown_call') req.log.warn({ vapiCallId: data.vapiCallId }, 'end-of-call report for unknown call');
        return reply.send({ ok: true, status: result.status });
      }

      default:
        return reply.send({});
    }
  });
}
