import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

let db: Db | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 5,
  match_all INTEGER NOT NULL DEFAULT 0,
  limit_period TEXT NOT NULL DEFAULT 'unlimited',
  max_downloads INTEGER NOT NULL DEFAULT 0,
  snatch_count INTEGER NOT NULL DEFAULT 0,
  snatch_history_timestamps TEXT NOT NULL DEFAULT '[]',
  media_types TEXT NOT NULL DEFAULT '["eBook","Audiobook"]',
  authors TEXT NOT NULL DEFAULT '[]',
  exclude_authors TEXT NOT NULL DEFAULT '[]',
  narrators TEXT NOT NULL DEFAULT '[]',
  series TEXT NOT NULL DEFAULT '[]',
  formats TEXT NOT NULL DEFAULT '["EPUB","M4B"]',
  title_pattern TEXT NOT NULL DEFAULT '',
  min_bitrate INTEGER NOT NULL DEFAULT 0,
  min_size_mb REAL NOT NULL DEFAULT 0,
  max_size_mb REAL NOT NULL DEFAULT 50000,
  freeleech_only INTEGER NOT NULL DEFAULT 0,
  vip_only INTEGER NOT NULL DEFAULT 0,
  client_type TEXT NOT NULL DEFAULT 'qbittorrent',
  client_category TEXT NOT NULL DEFAULT 'books',
  save_path TEXT NOT NULL DEFAULT '',
  discord_webhook_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wishlist_watches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  query TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  series TEXT NOT NULL DEFAULT '',
  narrator TEXT NOT NULL DEFAULT '',
  media_types TEXT NOT NULL DEFAULT '["eBook","Audiobook"]',
  formats TEXT NOT NULL DEFAULT '[]',
  interval_minutes INTEGER NOT NULL DEFAULT 30,
  last_run_at TEXT,
  last_result TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seen_torrents (
  torrent_id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS snatches (
  id TEXT PRIMARY KEY,
  torrent_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  series TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  filter_id TEXT,
  filter_name TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error TEXT,
  client_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_snatches_created ON snatches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_snatches_torrent ON snatches(torrent_id);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at DESC);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'viewer',
  enabled INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at);
`;

export function getDataDir(): string {
  return process.env.DATA_DIR || path.resolve(path.dirname(__dirname), '..', 'data');
}

export function getDownloadsDir(): string {
  return process.env.DOWNLOADS_DIR || path.resolve(path.dirname(__dirname), '..', 'downloads');
}

export function initDb(dbPath?: string): Db {
  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(getDownloadsDir(), { recursive: true });

  const preferred = path.join(dataDir, 'mybookbrr.db');
  const legacy = path.join(dataDir, 'newbookbot.db');
  const file =
    dbPath ||
    (fs.existsSync(preferred) ? preferred : fs.existsSync(legacy) ? legacy : preferred);
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Seed defaults
  const defaults: Record<string, string> = {
    mam_id: '',
    irc_nick: 'MyBookBRR',
    irc_nickserv_password: '',
    irc_enabled: 'false',
    irc_host: 'irc.myanonamouse.net',
    irc_port: '6697',
    irc_channel: '#announce',
    irc_status: 'disconnected',
    qbit_host: 'http://127.0.0.1:8080',
    qbit_username: 'admin',
    qbit_password: '',
    qbit_category: 'books',
    qbit_save_path: '',
    download_client: 'qbittorrent',
    watch_folder: path.join(getDownloadsDir(), 'watch'),
    discord_webhook_url: '',
    discord_webhook_stream: '',
    discord_webhook_errors: '',
    discord_webhook_snatch: '',
    wishlist_poll_enabled: 'true',
    wishlist_default_interval: '30',
    filters_auto_disable_on_unsatisfied: 'true',
    mam_unsatisfied_active: 'false',
    mam_unsatisfied_at: '',
    mam_unsatisfied_disabled_filters: '[]',
    last_announce: '',
    snatch_count_total: '0',
  };

  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(defaults)) {
      insert.run(k, v);
    }
  });
  tx();

  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('Database not initialized');
  return db;
}

export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export function setSettings(updates: Record<string, string>): void {
  const stmt = getDb().prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  const tx = getDb().transaction(() => {
    for (const [k, v] of Object.entries(updates)) {
      stmt.run(k, v);
    }
  });
  tx();
}
