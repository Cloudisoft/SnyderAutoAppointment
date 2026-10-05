import type { FastifyInstance } from 'fastify';
import type { DbClient } from '../../db/pool';
import type { Deps } from '../../deps';
import { authenticate, authOf } from '../../plugins/auth';

export interface NewInAppNotification {
  organizationId: string;
  userId?: string | null;
  /** When userId is null, everyone holding this permission sees it. */
  permission?: string | null;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  metadata?: Record<string, unknown>;
}

export async function notifyInApp(db: DbClient, n: NewInAppNotification) {
  await db.query(
    `insert into in_app_notifications(organization_id, user_id, permission, type, title, body, link, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [n.organizationId, n.userId ?? null, n.permission ?? null, n.type, n.title, n.body ?? null, n.link ?? null, n.metadata ?? {}],
  );
}

export async function registerNotificationRoutes(app: FastifyInstance, deps: Deps) {
  const auth = authenticate(deps);
  app.get('/api/notifications', { preHandler: [auth] }, async (req) => {
    const { organizationId, userId, permissions } = authOf(req);
    const { rows } = await deps.db.query(
      `select n.id, n.type, n.title, n.body, n.link, n.created_at, r.read_at
         from in_app_notifications n
         left join in_app_notification_reads r on r.notification_id = n.id and r.user_id = $2
        where n.organization_id = $1
          and (n.user_id = $2 or (n.user_id is null and (n.permission is null or n.permission = any($3::text[]))))
        order by n.created_at desc limit 50`,
      [organizationId, userId, [...permissions]],
    );
    return rows;
  });
  app.post('/api/notifications/read-all', { preHandler: [auth] }, async (req) => {
    const { organizationId, userId, permissions } = authOf(req);
    await deps.db.query(
      `insert into in_app_notification_reads(notification_id, user_id)
       select n.id, $2 from in_app_notifications n
        where n.organization_id = $1
          and (n.user_id = $2 or (n.user_id is null and (n.permission is null or n.permission = any($3::text[]))))
       on conflict do nothing`,
      [organizationId, userId, [...permissions]],
    );
    return { ok: true };
  });
}
