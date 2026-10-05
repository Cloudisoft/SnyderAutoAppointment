import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AGENT_MODELS, DEFAULT_AGENT_MODEL } from '@snyder/shared';
import type { Deps } from '../../deps';
import { notFound } from '../../lib/errors';
import { toE164 } from '../../lib/phone';
import { authenticate, authOf, requirePermission } from '../../plugins/auth';

const AgentInput = z.object({
  name: z.string().trim().min(1).max(100),
  voice_id: z.string().uuid().nullable().optional(),
  system_prompt: z.string().max(20_000).default(''),
  first_message: z.string().max(1_000).default(''),
  model: z
    .string()
    .default(DEFAULT_AGENT_MODEL)
    .refine((m) => AGENT_MODELS.some((o) => o.id === m), { message: 'Pick one of the supported models' }),
  temperature: z.number().min(0).max(2).default(0.5),
  transfer_number: z
    .string()
    .max(30)
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const e164 = toE164(v);
      if (!e164) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Transfer number is not a valid phone number' });
        return z.NEVER;
      }
      return e164;
    }),
  end_call_message: z.string().max(500).nullable().optional(),
  knowledge_base_id: z.string().uuid().nullable().optional(),
});

export async function registerAgentRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);
  const manage = [auth, requirePermission('settings.manage')];

  app.get('/api/agents', { preHandler: [auth] }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      `select a.*, v.name as voice_name from agents a left join voices v on v.id = a.voice_id
        where a.organization_id = $1 order by a.name`,
      [organizationId],
    );
    return rows;
  });

  app.post('/api/agents', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const b = AgentInput.parse(req.body);
    const { rows } = await db.query(
      `insert into agents(organization_id, name, voice_id, system_prompt, first_message, model, temperature,
                          transfer_number, end_call_message, knowledge_base_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [organizationId, b.name, b.voice_id ?? null, b.system_prompt, b.first_message, b.model, b.temperature,
        b.transfer_number ?? null, b.end_call_message ?? null, b.knowledge_base_id ?? null],
    );
    return reply.status(201).send(rows[0]);
  });

  app.put('/api/agents/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = AgentInput.parse(req.body);
    const { rows } = await db.query(
      `update agents set name=$3, voice_id=$4, system_prompt=$5, first_message=$6, model=$7, temperature=$8,
              transfer_number=$9, end_call_message=$10, knowledge_base_id=$11
        where id = $1 and organization_id = $2 returning *`,
      [id, organizationId, b.name, b.voice_id ?? null, b.system_prompt, b.first_message, b.model, b.temperature,
        b.transfer_number ?? null, b.end_call_message ?? null, b.knowledge_base_id ?? null],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  });

  app.delete('/api/agents/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { rowCount } = await db.query('delete from agents where id = $1 and organization_id = $2', [id, organizationId]);
    if (!rowCount) throw notFound();
    return { ok: true };
  });

  app.get('/api/knowledge-bases', { preHandler: [auth] }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query('select * from knowledge_bases where organization_id = $1 order by name', [organizationId]);
    return rows;
  });
  app.post('/api/knowledge-bases', { preHandler: manage }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const b = z.object({ name: z.string().trim().min(1), vapi_tool_id: z.string().trim().min(1) }).parse(req.body);
    const { rows } = await db.query(
      'insert into knowledge_bases(organization_id, name, vapi_tool_id) values ($1,$2,$3) returning *',
      [organizationId, b.name, b.vapi_tool_id],
    );
    return reply.status(201).send(rows[0]);
  });
  app.delete('/api/knowledge-bases/:id', { preHandler: manage }, async (req) => {
    const { organizationId } = authOf(req);
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.query('delete from knowledge_bases where id = $1 and organization_id = $2', [id, organizationId]);
    return { ok: true };
  });
}
