import type { FastifyReply, FastifyRequest } from 'fastify';
import { resolveApiKey } from './apiKeys.js';
import { readSessionCookie, resolveSessionUser } from './sessions.js';
import type { AuthIdentity } from './types.js';

function extractApiKey(req: FastifyRequest): string | undefined {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim()) return headerKey.trim();
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token.startsWith('mbb_') || token.startsWith('nbb_')) return token;
  }
  const q = (req.query as { api_key?: string } | undefined)?.api_key;
  if (typeof q === 'string' && (q.startsWith('mbb_') || q.startsWith('nbb_'))) return q;
  return undefined;
}

export function attachAuth(req: FastifyRequest): void {
  const apiRaw = extractApiKey(req);
  if (apiRaw) {
    const resolved = resolveApiKey(apiRaw);
    if (resolved) {
      req.auth = {
        user: resolved.user,
        authType: 'api_key',
        scopes: resolved.scopes,
        apiKeyId: resolved.apiKeyId,
      } satisfies AuthIdentity;
      return;
    }
  }

  const cookieToken = readSessionCookie(req.cookies as Record<string, string> | undefined);
  // Legacy: Bearer session hex tokens are no longer accepted — only mbb_/nbb_ API keys via Bearer
  const user = resolveSessionUser(cookieToken);
  if (user) {
    req.auth = {
      user,
      authType: 'session',
      scopes: null,
    };
  }
}

export async function authHook(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  attachAuth(req);
}
