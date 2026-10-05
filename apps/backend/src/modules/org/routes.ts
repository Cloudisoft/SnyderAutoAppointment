import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTx } from '../../db/pool';
import type { Deps } from '../../deps';
import { badRequest, notFound } from '../../lib/errors';
import { authenticate, authenticateUser, authOf, requirePermission } from '../../plugins/auth';
import { isValidTimeZone } from '../../lib/timezone';

const OrgUpdate = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  time_zone: z.string().min(1).optional(),
});

export { isValidTimeZone } from '../../lib/timezone';

export async function registerOrgRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const auth = authenticate(deps);
  const userOnly = authenticateUser(deps);

  // Current user, active organization, permissions and all memberships.
  app.get('/api/me', { preHandler: [userOnly] }, async (req) => {
    const user = req.authUser!;
    const { rows: memberships } = await db.query(
      `select o.id, o.name, o.time_zone, r.key as role_key, r.name as role_name,
              array_remove(array_agg(rp.permission_key order by rp.permission_key), null) as permissions
         from memberships m
         join organizations o on o.id = m.organization_id
         join roles r on r.id = m.role_id
         left join role_permissions rp on rp.role_id = r.id
        where m.user_id = $1
        group by o.id, r.key, r.name, m.created_at
        order by m.created_at`,
      [user.id],
    );
    return { user, organizations: memberships };
  });

  // First-run bootstrap: a signed-in user with no organization creates one and becomes owner.
  app.post('/api/organizations', { preHandler: [userOnly] }, async (req, reply) => {
    const user = req.authUser!;
    const body = z
      .object({ name: z.string().trim().min(1).max(200), time_zone: z.string().default('America/New_York') })
      .parse(req.body);
    if (!isValidTimeZone(body.time_zone)) throw badRequest('Unknown time zone');
    const org = await withTx(db, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        'insert into organizations(name, time_zone) values ($1, $2) returning id, name, time_zone',
        [body.name, body.time_zone],
      );
      const orgId = rows[0]!.id;
      await c.query(
        `insert into profiles(id, email) values ($1, $2) on conflict (id) do nothing`,
        [user.id, user.email],
      );
      await c.query(
        `insert into memberships(organization_id, user_id, role_id)
         select $1, $2, id from roles where organization_id = $1 and key = 'owner'`,
        [orgId, user.id],
      );
      return rows[0];
    });
    return reply.status(201).send(org);
  });

  app.patch('/api/organization', { preHandler: [auth, requirePermission('org.manage')] }, async (req) => {
    const { organizationId } = authOf(req);
    const body = OrgUpdate.parse(req.body);
    if (body.time_zone && !isValidTimeZone(body.time_zone)) throw badRequest('Unknown time zone');
    const { rows } = await db.query(
      `update organizations set name = coalesce($2, name), time_zone = coalesce($3, time_zone)
        where id = $1 returning id, name, time_zone`,
      [organizationId, body.name ?? null, body.time_zone ?? null],
    );
    return rows[0];
  });

  app.get('/api/organization/users', { preHandler: [auth, requirePermission('users.manage')] }, async (req) => {
    const { organizationId } = authOf(req);
    const { rows } = await db.query(
      `select m.user_id as id, p.full_name, coalesce(p.email, u.email) as email, r.id as role_id, r.key as role_key,
              r.name as role_name, m.created_at
         from memberships m
         join roles r on r.id = m.role_id
         left join profiles p on p.id = m.user_id
         left join auth.users u on u.id = m.user_id
        where m.organization_id = $1
        order by m.created_at`,
      [organizationId],
    );
    return rows;
  });

  app.post('/api/organization/users', { preHandler: [auth, requirePermission('users.manage')] }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z.object({ email: z.string().email(), role_id: z.string().uuid() }).parse(req.body);
    const role = await db.query('select id from roles where id = $1 and organization_id = $2', [
      body.role_id,
      organizationId,
    ]);
    if (!role.rowCount) throw badRequest('Unknown role');
    const user = await deps.supabaseAdmin.inviteUser(body.email, deps.config.APP_PUBLIC_URL);
    await withTx(db, async (c) => {
      await c.query(`insert into profiles(id, email) values ($1, $2) on conflict (id) do nothing`, [
        user.id,
        user.email,
      ]);
      await c.query(
        `insert into memberships(organization_id, user_id, role_id) values ($1, $2, $3)
         on conflict (organization_id, user_id) do update set role_id = excluded.role_id`,
        [organizationId, user.id, body.role_id],
      );
    });
    return reply.status(201).send({ id: user.id, email: user.email });
  });

  app.patch(
    '/api/organization/users/:userId',
    { preHandler: [auth, requirePermission('users.manage')] },
    async (req) => {
      const { organizationId } = authOf(req);
      const { userId } = z.object({ userId: z.string().uuid() }).parse(req.params);
      const body = z.object({ role_id: z.string().uuid() }).parse(req.body);
      const { rowCount } = await db.query(
        `update memberships set role_id = r.id from roles r
          where memberships.organization_id = $1 and memberships.user_id = $2
            and r.id = $3 and r.organization_id = $1`,
        [organizationId, userId, body.role_id],
      );
      if (!rowCount) throw notFound();
      return { ok: true };
    },
  );

  app.get('/api/organization/roles', { preHandler: [auth] }, async (req) => {
    const { organizationId } = authOf(req);
    const [roles, permissions] = await Promise.all([
      db.query(
        `select r.id, r.key, r.name, r.is_system,
                array_remove(array_agg(rp.permission_key order by rp.permission_key), null) as permissions
           from roles r left join role_permissions rp on rp.role_id = r.id
          where r.organization_id = $1
          group by r.id order by r.created_at`,
        [organizationId],
      ),
      db.query('select key, description from permissions order by key'),
    ]);
    return { roles: roles.rows, permissions: permissions.rows };
  });

  app.post('/api/organization/roles', { preHandler: [auth, requirePermission('users.manage')] }, async (req, reply) => {
    const { organizationId } = authOf(req);
    const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const key = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'role';
    const { rows } = await db.query(
      `insert into roles(organization_id, key, name) values ($1, $2, $3) returning id, key, name, is_system`,
      [organizationId, `${key}_${Date.now().toString(36)}`, body.name],
    );
    return reply.status(201).send(rows[0]);
  });

  app.put(
    '/api/organization/roles/:roleId/permissions',
    { preHandler: [auth, requirePermission('users.manage')] },
    async (req) => {
      const { organizationId } = authOf(req);
      const { roleId } = z.object({ roleId: z.string().uuid() }).parse(req.params);
      const body = z.object({ permissions: z.array(z.string()) }).parse(req.body);
      await withTx(db, async (c) => {
        const role = await c.query<{ key: string }>(
          'select key from roles where id = $1 and organization_id = $2 for update',
          [roleId, organizationId],
        );
        if (!role.rowCount) throw notFound();
        if (role.rows[0]!.key === 'owner') throw badRequest('The owner role always has every permission');
        await c.query('delete from role_permissions where role_id = $1', [roleId]);
        await c.query(
          `insert into role_permissions(role_id, permission_key)
           select $1, key from permissions where key = any($2::text[])`,
          [roleId, body.permissions],
        );
      });
      return { ok: true };
    },
  );
}
