import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ApiScope, UserRole } from './types.js';

export function requireUser(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.auth?.user) return true;
  reply.code(401).send({ error: 'Unauthorized' });
  return false;
}

export function requireRole(req: FastifyRequest, reply: FastifyReply, role: UserRole): boolean {
  if (!requireUser(req, reply)) return false;
  const user = req.auth!.user;
  if (role === 'viewer') return true;
  if (user.role === 'admin') return true;
  reply.code(403).send({ error: 'Forbidden', message: 'Admin role required' });
  return false;
}

/** Session users: admin has all scopes; viewer has read scopes only. API keys: explicit scopes. */
export function identityHasScope(req: FastifyRequest, scope: ApiScope): boolean {
  const auth = req.auth;
  if (!auth?.user) return false;
  if (auth.scopes) return auth.scopes.includes(scope);
  if (auth.user.role === 'admin') return true;
  // viewer session: read-only scopes
  return (
    scope.endsWith(':read') ||
    scope === 'status:read' ||
    scope === 'filters:read' ||
    scope === 'wishlist:read' ||
    scope === 'history:read' ||
    scope === 'events:read'
  );
}

export function requireScope(req: FastifyRequest, reply: FastifyReply, scope: ApiScope): boolean {
  if (!requireUser(req, reply)) return false;
  if (identityHasScope(req, scope)) return true;
  reply.code(403).send({ error: 'Forbidden', message: `Missing scope: ${scope}` });
  return false;
}

export function isAdmin(req: FastifyRequest): boolean {
  return req.auth?.user?.role === 'admin';
}
