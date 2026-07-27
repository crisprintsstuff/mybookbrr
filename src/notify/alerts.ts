import { notifySystemError } from './discord.js';

/** Cooldown so reconnect storms / repeated poll errors don't spam Discord. */
const COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS || 30 * 60 * 1000);
const lastAlertAt = new Map<string, number>();

export function isMamSessionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /not signed in|invalid mam_id|expired mam_id|missing mam_id/i.test(msg);
}

/**
 * Fire a Discord errors-webhook alert at most once per key within the cooldown window.
 */
export async function alertOnce(
  key: string,
  event: string,
  message: string,
  component = 'MyBookBRR'
): Promise<boolean> {
  const now = Date.now();
  const prev = lastAlertAt.get(key) || 0;
  if (now - prev < COOLDOWN_MS) return false;
  lastAlertAt.set(key, now);
  await notifySystemError(event, message, component);
  return true;
}

export async function alertIrcFailure(phase: string, detail: string | null): Promise<void> {
  const normalized = String(phase || '').toLowerCase();
  if (!['auth_failed', 'join_failed', 'error'].includes(normalized)) return;
  const titles: Record<string, string> = {
    auth_failed: 'IRC NickServ authentication failed',
    join_failed: 'IRC channel join failed',
    error: 'IRC connection error',
  };
  await alertOnce(
    `irc:${normalized}`,
    titles[normalized] || `IRC failure (${normalized})`,
    detail || `IRC entered phase ${normalized}`,
    'IRC'
  );
}

export async function alertWishlistError(watchId: string, message: string): Promise<void> {
  await alertOnce(
    `wishlist:${watchId || 'unknown'}`,
    'Wishlist watch error',
    `Watch ${watchId || '—'}: ${message}`,
    'Wishlist'
  );
}

export async function alertMamSessionDead(message: string, source = 'MAM'): Promise<void> {
  await alertOnce(
    'mam:session',
    'MAM session invalid or expired',
    message || 'mam_id cookie is missing, invalid, or expired',
    source
  );
}
