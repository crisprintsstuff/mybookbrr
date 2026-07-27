import { getDb } from './index.js';

const DEFAULT_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h

let timer: NodeJS.Timeout | null = null;

/**
 * WAL checkpoint + optional VACUUM when idle.
 * Safe to run while the process is live; VACUUM is skipped if disabled.
 */
export function runDbMaintenance(reason = 'scheduled'): void {
  const db = getDb();
  try {
    const ck = db.pragma('wal_checkpoint(TRUNCATE)') as unknown;
    console.log(`[Maintenance] ${reason}: wal_checkpoint`, ck);
  } catch (err) {
    console.warn('[Maintenance] wal_checkpoint failed:', err);
    return;
  }

  if (process.env.DB_VACUUM === 'true') {
    try {
      // VACUUM cannot run inside a transaction; better-sqlite3 handles this.
      db.exec('VACUUM');
      console.log(`[Maintenance] ${reason}: VACUUM complete`);
    } catch (err) {
      console.warn('[Maintenance] VACUUM failed:', err);
    }
  }
}

export function startMaintenanceScheduler(): void {
  if (process.env.DB_MAINTENANCE === 'false') {
    console.log('[Maintenance] Scheduler disabled (DB_MAINTENANCE=false)');
    return;
  }
  if (timer) return;

  const hours = Number(process.env.DB_MAINTENANCE_HOURS || 12);
  const ms =
    Number.isFinite(hours) && hours > 0 ? hours * 60 * 60 * 1000 : DEFAULT_INTERVAL_MS;

  console.log(
    `[Maintenance] Scheduler every ${Math.round(ms / 3600000)}h (VACUUM=${process.env.DB_VACUUM === 'true' ? 'on' : 'off — set DB_VACUUM=true to enable'})`
  );

  // First run after a quiet boot window
  setTimeout(() => {
    try {
      runDbMaintenance('startup');
    } catch (err) {
      console.warn('[Maintenance] startup failed:', err);
    }
  }, 5 * 60_000);

  timer = setInterval(() => {
    try {
      runDbMaintenance('scheduled');
    } catch (err) {
      console.warn('[Maintenance] scheduled failed:', err);
    }
  }, ms);
  timer.unref?.();
}
