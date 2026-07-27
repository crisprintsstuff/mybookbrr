import {
  countRecentLoginAttempts,
  purgeOldLoginAttempts,
  recordLoginAttempt,
} from '../db/authRepos.js';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;

export function checkLoginRateLimit(ip: string): { ok: boolean; retryAfterSec?: number } {
  purgeOldLoginAttempts(WINDOW_MS * 10);
  const count = countRecentLoginAttempts(ip || 'unknown', WINDOW_MS);
  if (count >= MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: 60 };
  }
  return { ok: true };
}

export function noteLoginAttempt(ip: string): void {
  recordLoginAttempt(ip || 'unknown');
}
