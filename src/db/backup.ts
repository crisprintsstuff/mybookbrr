import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, getDb, getDbPath } from '../db/index.js';

const DEFAULT_KEEP = 7;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let running = false;

function backupsDir(): string {
  return process.env.BACKUP_DIR || path.join(getDataDir(), 'backups');
}

function keepCount(): number {
  const n = Number(process.env.BACKUP_KEEP || DEFAULT_KEEP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_KEEP;
}

function intervalMs(): number {
  const hours = Number(process.env.BACKUP_INTERVAL_HOURS || 24);
  if (Number.isFinite(hours) && hours > 0) return hours * 60 * 60 * 1000;
  return DEFAULT_INTERVAL_MS;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function pruneOldBackups(dir: string): void {
  const keep = keepCount();
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^mybookbrr-.+\.db$/i.test(f))
    .map((f) => ({ name: f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const old of files.slice(keep)) {
    try {
      fs.unlinkSync(old.full);
      console.log(`[Backup] Pruned ${old.name}`);
    } catch (err) {
      console.warn('[Backup] Failed to prune', old.name, err);
    }
  }
}

/** Online SQLite backup into DATA_DIR/backups (keeps last N copies). */
export async function runDatabaseBackup(reason = 'scheduled'): Promise<string> {
  if (running) throw new Error('Backup already in progress');
  running = true;
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `mybookbrr-${stamp()}.db`);
  try {
    const db = getDb();
    // better-sqlite3 backup() returns a Promise
    await db.backup(dest);
    pruneOldBackups(dir);
    console.log(`[Backup] ${reason}: ${dest} (source ${getDbPath()})`);
    return dest;
  } catch (err) {
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    running = false;
  }
}

export function startBackupScheduler(): void {
  if (process.env.BACKUP_ENABLED === 'false') {
    console.log('[Backup] Scheduler disabled (BACKUP_ENABLED=false)');
    return;
  }
  if (timer) return;

  const ms = intervalMs();
  console.log(`[Backup] Scheduler every ${Math.round(ms / 3600000)}h → ${backupsDir()} (keep ${keepCount()})`);

  // First backup a few minutes after boot so startup isn't blocked.
  setTimeout(() => {
    void runDatabaseBackup('startup').catch((err) =>
      console.error('[Backup] startup backup failed:', err)
    );
  }, 60_000);

  timer = setInterval(() => {
    void runDatabaseBackup('scheduled').catch((err) =>
      console.error('[Backup] scheduled backup failed:', err)
    );
  }, ms);
  // Don't keep the process alive solely for backups if something else exits.
  timer.unref?.();
}
