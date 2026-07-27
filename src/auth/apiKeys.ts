import { createHash, randomBytes } from 'node:crypto';
import {
  createApiKey,
  findApiKeyByHash,
  listApiKeys,
  revokeApiKey,
  touchApiKey,
  type ApiKeyRow,
} from '../db/authRepos.js';
import type { ApiScope, User } from './types.js';
import { ALL_SCOPES } from './types.js';

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function generateApiKeySecret(): { raw: string; prefix: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  const raw = `mbb_${secret}`;
  const prefix = raw.slice(0, 12);
  return { raw, prefix, hash: hashApiKey(raw) };
}

function isApiKeyRaw(raw: string): boolean {
  return raw.startsWith('mbb_') || raw.startsWith('nbb_');
}

export function normalizeScopes(scopes: string[]): ApiScope[] {
  const allowed = new Set<string>(ALL_SCOPES);
  return Array.from(new Set(scopes.filter((s) => allowed.has(s)))) as ApiScope[];
}

export function createKeyedApiKey(input: {
  userId: string;
  name: string;
  scopes: string[];
  expiresAt?: string | null;
}): { key: ApiKeyRow; raw: string } {
  const { raw, prefix, hash } = generateApiKeySecret();
  const key = createApiKey({
    userId: input.userId,
    name: input.name,
    keyPrefix: prefix,
    keyHash: hash,
    scopes: normalizeScopes(input.scopes),
    expiresAt: input.expiresAt,
  });
  return { key, raw };
}

export function resolveApiKey(raw: string | undefined): { user: User; scopes: ApiScope[]; apiKeyId: string } | null {
  if (!raw || !isApiKeyRaw(raw)) return null;
  const found = findApiKeyByHash(hashApiKey(raw));
  if (!found) return null;
  touchApiKey(found.id);
  return { user: found.user, scopes: found.scopes, apiKeyId: found.id };
}

export function listActiveApiKeys(): ApiKeyRow[] {
  return listApiKeys();
}

export function revokeKeyedApiKey(id: string): boolean {
  return revokeApiKey(id);
}
