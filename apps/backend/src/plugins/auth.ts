import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../deps';
import { forbidden, unauthorized } from '../lib/errors';

export interface AuthContext {
  userId: string;
  email: string | null;
  organizationId: string;
  roleKey: string;
  permissions: Set<string>;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
    authUser?: { id: string; email: string | null };
  }
}

function bearer(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h || !h.toLowerCase().startsWith('bearer ')) return null;
  return h.slice(7).trim() || null;
}

/** Verifies the Supabase JWT only (no organization required). */
export function authenticateUser(deps: Deps) {
  return async (req: FastifyRequest) => {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const user = await deps.auth.verify(token);
    if (!user) throw unauthorized('Invalid or expired session');
    req.authUser = user;
  };
}

/**
 * Verifies the JWT and resolves the caller's organization membership and permissions.
 * The organization is taken from the x-organization-id header, or the user's first membership.
 */
export function authenticate(deps: Deps) {
  const verifyUser = authenticateUser(deps);
  return async (req: FastifyRequest) => {
    await verifyUser(req);
    const user = req.authUser!;
    const requestedOrg = req.headers['x-organization-id'];
    const { rows } = await deps.db.query<{
      organization_id: string;
      role_key: string;
      permissions: string[] | null;
    }>(
      `select m.organization_id, r.key as role_key,
              array_remove(array_agg(rp.permission_key), null) as permissions
         from memberships m
         join roles r on r.id = m.role_id
         left join role_permissions rp on rp.role_id = m.role_id
        where m.user_id = $1 and ($2::uuid is null or m.organization_id = $2::uuid)
        group by m.organization_id, r.key, m.created_at
        order by m.created_at
        limit 1`,
      [user.id, typeof requestedOrg === 'string' && requestedOrg ? requestedOrg : null],
    );
    const m = rows[0];
    if (!m) throw forbidden('No access to this organization');
    req.auth = {
      userId: user.id,
      email: user.email,
      organizationId: m.organization_id,
      roleKey: m.role_key,
      permissions: new Set(m.permissions ?? []),
    };
  };
}

export function requirePermission(...perms: string[]) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.auth;
    if (!auth) throw unauthorized();
    const missing = perms.filter((p) => !auth.permissions.has(p));
    if (missing.length) throw forbidden(`Missing permission: ${missing.join(', ')}`);
  };
}

export function authOf(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
