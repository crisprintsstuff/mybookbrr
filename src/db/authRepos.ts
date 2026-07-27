import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';
import type { ApiScope, User, UserRole } from '../auth/types.js';

function rowToUser(r: Record<string, unknown>): User {
  return {
    id: String(r.id),
    username: String(r.username),
    role: (r.role === 'admin' ? 'admin' : 'viewer') as UserRole,
    enabled: Boolean(r.enabled),
    mustChangePassword: Boolean(r.must_change_password),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    lastLoginAt: r.last_login_at ? String(r.last_login_at) : null,
  };
}

export function countUsers(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number };
  return row.c;
}

export function listUsers(): User[] {
  const rows = getDb()
    .prepare('SELECT * FROM users ORDER BY username COLLATE NOCASE ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToUser);
}

export function getUserById(id: string): User | null {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToUser(row) : null;
}

export function getUserByUsername(username: string): (User & { passwordHash: string }) | null {
  const row = getDb()
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: String(row.password_hash) };
}

export function createUser(input: {
  username: string;
  passwordHash: string;
  role: UserRole;
  mustChangePassword?: boolean;
}): User {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, enabled, must_change_password)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(id, input.username.trim(), input.passwordHash, input.role, input.mustChangePassword ? 1 : 0);
  return getUserById(id)!;
}

export function updateUser(
  id: string,
  patch: {
    passwordHash?: string;
    role?: UserRole;
    enabled?: boolean;
    mustChangePassword?: boolean;
  }
): User | null {
  const existing = getUserById(id);
  if (!existing) return null;
  const passwordHash =
    patch.passwordHash ??
    (getDb().prepare('SELECT password_hash FROM users WHERE id = ?').get(id) as { password_hash: string })
      .password_hash;
  getDb()
    .prepare(
      `UPDATE users SET
        password_hash = ?,
        role = ?,
        enabled = ?,
        must_change_password = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    )
    .run(
      passwordHash,
      patch.role ?? existing.role,
      (patch.enabled ?? existing.enabled) ? 1 : 0,
      (patch.mustChangePassword ?? existing.mustChangePassword) ? 1 : 0,
      id
    );
  return getUserById(id);
}

export function touchUserLogin(id: string): void {
  getDb()
    .prepare(`UPDATE users SET last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`)
    .run(id);
}

export function createSession(input: {
  tokenHash: string;
  userId: string;
  expiresAt: string;
  ip?: string;
  userAgent?: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.tokenHash, input.userId, input.expiresAt, input.ip || '', input.userAgent || '');
}

export function getSessionUser(tokenHash: string): User | null {
  const row = getDb()
    .prepare(
      `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?
         AND s.revoked_at IS NULL
         AND datetime(s.expires_at) > datetime('now')
         AND u.enabled = 1`
    )
    .get(tokenHash) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export function revokeSession(tokenHash: string): void {
  getDb()
    .prepare(`UPDATE sessions SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`)
    .run(tokenHash);
}

export function revokeUserSessions(userId: string): void {
  getDb()
    .prepare(
      `UPDATE sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`
    )
    .run(userId);
}

export function purgeExpiredSessions(): void {
  getDb()
    .prepare(
      `DELETE FROM sessions WHERE datetime(expires_at) < datetime('now') OR revoked_at IS NOT NULL`
    )
    .run();
}

export interface ApiKeyRow {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  scopes: ApiScope[];
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

function rowToKey(r: Record<string, unknown>): ApiKeyRow {
  let scopes: ApiScope[] = [];
  try {
    scopes = JSON.parse(String(r.scopes || '[]')) as ApiScope[];
  } catch {
    scopes = [];
  }
  return {
    id: String(r.id),
    userId: String(r.user_id),
    name: String(r.name),
    keyPrefix: String(r.key_prefix),
    scopes,
    enabled: Boolean(r.enabled),
    expiresAt: r.expires_at ? String(r.expires_at) : null,
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
    createdAt: String(r.created_at),
    revokedAt: r.revoked_at ? String(r.revoked_at) : null,
  };
}

export function listApiKeys(): ApiKeyRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC`
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToKey);
}

export function createApiKey(input: {
  userId: string;
  name: string;
  keyPrefix: string;
  keyHash: string;
  scopes: ApiScope[];
  expiresAt?: string | null;
}): ApiKeyRow {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, key_prefix, key_hash, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.userId,
      input.name.trim(),
      input.keyPrefix,
      input.keyHash,
      JSON.stringify(input.scopes),
      input.expiresAt || null
    );
  const row = getDb().prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as Record<string, unknown>;
  return rowToKey(row);
}

export function findApiKeyByHash(keyHash: string): (ApiKeyRow & { user: User }) | null {
  const row = getDb()
    .prepare(
      `SELECT k.*, u.id AS uid, u.username, u.role, u.enabled AS uenabled,
              u.must_change_password, u.created_at AS ucreated, u.updated_at AS uupdated, u.last_login_at
       FROM api_keys k
       JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ?
         AND k.revoked_at IS NULL
         AND k.enabled = 1
         AND u.enabled = 1
         AND (k.expires_at IS NULL OR datetime(k.expires_at) > datetime('now'))`
    )
    .get(keyHash) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...rowToKey(row),
    user: {
      id: String(row.uid),
      username: String(row.username),
      role: (row.role === 'admin' ? 'admin' : 'viewer') as UserRole,
      enabled: Boolean(row.uenabled),
      mustChangePassword: Boolean(row.must_change_password),
      createdAt: String(row.ucreated),
      updatedAt: String(row.uupdated),
      lastLoginAt: row.last_login_at ? String(row.last_login_at) : null,
    },
  };
}

export function touchApiKey(id: string): void {
  getDb().prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(id);
}

export function revokeApiKey(id: string): boolean {
  const r = getDb()
    .prepare(
      `UPDATE api_keys SET revoked_at = datetime('now'), enabled = 0 WHERE id = ? AND revoked_at IS NULL`
    )
    .run(id);
  return r.changes > 0;
}

export function recordLoginAttempt(ip: string): void {
  getDb()
    .prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)')
    .run(ip, Date.now());
}

export function countRecentLoginAttempts(ip: string, windowMs: number): number {
  const since = Date.now() - windowMs;
  const row = getDb()
    .prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE ip = ? AND attempted_at > ?')
    .get(ip, since) as { c: number };
  return row.c;
}

export function purgeOldLoginAttempts(olderThanMs: number): void {
  getDb()
    .prepare('DELETE FROM login_attempts WHERE attempted_at < ?')
    .run(Date.now() - olderThanMs);
}
