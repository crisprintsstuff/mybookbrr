import { createHash, randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import {
  createSession,
  getSessionUser,
  purgeExpiredSessions,
  revokeSession,
  touchUserLogin,
} from '../db/authRepos.js';
import type { User } from './types.js';

const COOKIE_NAME = 'mbb_session';
const LEGACY_COOKIE_NAME = 'nbb_session';

export function sessionTtlMs(): number {
  const days = Number(process.env.SESSION_TTL_DAYS || 7);
  return Math.max(1, days) * 24 * 60 * 60 * 1000;
}

export function cookieSecure(): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.TRUST_PROXY === 'true' || process.env.HTTPS === 'true';
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createUserSession(
  user: User,
  meta: { ip?: string; userAgent?: string } = {}
): { token: string; expiresAt: Date } {
  purgeExpiredSessions();
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  createSession({
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt: expiresAt.toISOString(),
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  touchUserLogin(user.id);
  return { token, expiresAt };
}

export function resolveSessionUser(token: string | undefined): User | null {
  if (!token) return null;
  return getSessionUser(hashToken(token));
}

export function destroySession(token: string | undefined): void {
  if (!token) return;
  revokeSession(hashToken(token));
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: cookieSecure(),
    maxAge: Math.floor((expiresAt.getTime() - Date.now()) / 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' });
  reply.clearCookie(LEGACY_COOKIE_NAME, { path: '/' });
}

export function readSessionCookie(cookies: Record<string, string> | undefined): string | undefined {
  return cookies?.[COOKIE_NAME] || cookies?.[LEGACY_COOKIE_NAME];
}

export { COOKIE_NAME };
