import { randomUUID } from 'node:crypto';
import { getDb } from './index.js';
import type { FilterRule, SnatchRecord, WishlistWatch } from '../types.js';

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToFilter(r: Record<string, unknown>): FilterRule {
  return {
    id: String(r.id),
    name: String(r.name),
    enabled: Boolean(r.enabled),
    priority: Number(r.priority),
    matchAllReleases: Boolean(r.match_all),
    limitPeriod: (r.limit_period as FilterRule['limitPeriod']) || 'unlimited',
    maxDownloads: Number(r.max_downloads || 0),
    snatchCount: Number(r.snatch_count || 0),
    snatchHistoryTimestamps: parseJson(String(r.snatch_history_timestamps || '[]'), []),
    mediaTypes: parseJson(String(r.media_types || '[]'), ['eBook', 'Audiobook']),
    authors: parseJson(String(r.authors || '[]'), []),
    excludeAuthors: parseJson(String(r.exclude_authors || '[]'), []),
    narrators: parseJson(String(r.narrators || '[]'), []),
    series: parseJson(String(r.series || '[]'), []),
    formats: parseJson(String(r.formats || '[]'), ['EPUB', 'M4B']),
    titlePattern: String(r.title_pattern || ''),
    minBitrate: Number(r.min_bitrate || 0),
    minSizeMB: Number(r.min_size_mb || 0),
    maxSizeMB: Number(r.max_size_mb || 50000),
    freeleechOnly: Boolean(r.freeleech_only),
    vipOnly: Boolean(r.vip_only),
    clientType: (r.client_type as FilterRule['clientType']) || 'qbittorrent',
    clientCategory: String(r.client_category || 'books'),
    savePath: String(r.save_path || ''),
    discordWebhookUrl: String(r.discord_webhook_url || ''),
  };
}

export function listFilters(): FilterRule[] {
  const rows = getDb()
    .prepare('SELECT * FROM filters ORDER BY priority DESC, name ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToFilter);
}

export function getFilter(id: string): FilterRule | null {
  const row = getDb().prepare('SELECT * FROM filters WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToFilter(row) : null;
}

export function saveFilter(input: Partial<FilterRule> & { name?: string }): FilterRule {
  const id = input.id || randomUUID();
  const existing = getFilter(id);
  const filter: FilterRule = {
    id,
    name: input.name ?? existing?.name ?? 'Untitled Rule',
    enabled: input.enabled ?? existing?.enabled ?? true,
    priority: input.priority ?? existing?.priority ?? 5,
    matchAllReleases: input.matchAllReleases ?? existing?.matchAllReleases ?? false,
    limitPeriod: input.limitPeriod ?? existing?.limitPeriod ?? 'unlimited',
    maxDownloads: input.maxDownloads ?? existing?.maxDownloads ?? 0,
    snatchCount: input.snatchCount ?? existing?.snatchCount ?? 0,
    snatchHistoryTimestamps:
      input.snatchHistoryTimestamps ?? existing?.snatchHistoryTimestamps ?? [],
    mediaTypes: input.mediaTypes ?? existing?.mediaTypes ?? ['eBook', 'Audiobook'],
    authors: input.authors ?? existing?.authors ?? [],
    excludeAuthors: input.excludeAuthors ?? existing?.excludeAuthors ?? [],
    narrators: input.narrators ?? existing?.narrators ?? [],
    series: input.series ?? existing?.series ?? [],
    formats: input.formats ?? existing?.formats ?? ['EPUB', 'M4B'],
    titlePattern: input.titlePattern ?? existing?.titlePattern ?? '',
    minBitrate: input.minBitrate ?? existing?.minBitrate ?? 0,
    minSizeMB: input.minSizeMB ?? existing?.minSizeMB ?? 0,
    maxSizeMB: input.maxSizeMB ?? existing?.maxSizeMB ?? 50000,
    freeleechOnly: input.freeleechOnly ?? existing?.freeleechOnly ?? false,
    vipOnly: input.vipOnly ?? existing?.vipOnly ?? false,
    clientType: input.clientType ?? existing?.clientType ?? 'qbittorrent',
    clientCategory: input.clientCategory ?? existing?.clientCategory ?? 'books',
    savePath: input.savePath ?? existing?.savePath ?? '',
    discordWebhookUrl: input.discordWebhookUrl ?? existing?.discordWebhookUrl ?? '',
  };

  getDb()
    .prepare(
      `INSERT INTO filters (
        id, name, enabled, priority, match_all, limit_period, max_downloads,
        snatch_count, snatch_history_timestamps, media_types, authors, exclude_authors,
        narrators, series, formats, title_pattern, min_bitrate, min_size_mb, max_size_mb,
        freeleech_only, vip_only, client_type, client_category, save_path, discord_webhook_url,
        updated_at
      ) VALUES (
        @id, @name, @enabled, @priority, @match_all, @limit_period, @max_downloads,
        @snatch_count, @snatch_history_timestamps, @media_types, @authors, @exclude_authors,
        @narrators, @series, @formats, @title_pattern, @min_bitrate, @min_size_mb, @max_size_mb,
        @freeleech_only, @vip_only, @client_type, @client_category, @save_path, @discord_webhook_url,
        datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, enabled=excluded.enabled, priority=excluded.priority,
        match_all=excluded.match_all, limit_period=excluded.limit_period,
        max_downloads=excluded.max_downloads, snatch_count=excluded.snatch_count,
        snatch_history_timestamps=excluded.snatch_history_timestamps,
        media_types=excluded.media_types, authors=excluded.authors,
        exclude_authors=excluded.exclude_authors, narrators=excluded.narrators,
        series=excluded.series, formats=excluded.formats, title_pattern=excluded.title_pattern,
        min_bitrate=excluded.min_bitrate, min_size_mb=excluded.min_size_mb,
        max_size_mb=excluded.max_size_mb, freeleech_only=excluded.freeleech_only,
        vip_only=excluded.vip_only, client_type=excluded.client_type,
        client_category=excluded.client_category, save_path=excluded.save_path,
        discord_webhook_url=excluded.discord_webhook_url, updated_at=datetime('now')`
    )
    .run({
      id: filter.id,
      name: filter.name,
      enabled: filter.enabled ? 1 : 0,
      priority: filter.priority,
      match_all: filter.matchAllReleases ? 1 : 0,
      limit_period: filter.limitPeriod,
      max_downloads: filter.maxDownloads,
      snatch_count: filter.snatchCount,
      snatch_history_timestamps: JSON.stringify(filter.snatchHistoryTimestamps),
      media_types: JSON.stringify(filter.mediaTypes),
      authors: JSON.stringify(filter.authors),
      exclude_authors: JSON.stringify(filter.excludeAuthors),
      narrators: JSON.stringify(filter.narrators),
      series: JSON.stringify(filter.series),
      formats: JSON.stringify(filter.formats),
      title_pattern: filter.titlePattern,
      min_bitrate: filter.minBitrate,
      min_size_mb: filter.minSizeMB,
      max_size_mb: filter.maxSizeMB,
      freeleech_only: filter.freeleechOnly ? 1 : 0,
      vip_only: filter.vipOnly ? 1 : 0,
      client_type: filter.clientType,
      client_category: filter.clientCategory,
      save_path: filter.savePath,
      discord_webhook_url: filter.discordWebhookUrl,
    });

  return filter;
}

export function deleteFilter(id: string): void {
  getDb().prepare('DELETE FROM filters WHERE id = ?').run(id);
}

export function bumpFilterSnatch(filterId: string): void {
  const filter = getFilter(filterId);
  if (!filter) return;
  const timestamps = [...filter.snatchHistoryTimestamps, Date.now()].slice(-200);
  saveFilter({
    ...filter,
    snatchCount: filter.snatchCount + 1,
    snatchHistoryTimestamps: timestamps,
  });
}

/** Disable all currently enabled filters. Returns the IDs that were turned off. */
export function disableAllEnabledFilters(): string[] {
  const enabled = listFilters().filter((f) => f.enabled);
  for (const filter of enabled) {
    saveFilter({ ...filter, enabled: false });
  }
  return enabled.map((f) => f.id);
}

/** Re-enable filters by id (used after clearing MAM unsatisfied-limit lockout). */
export function enableFiltersByIds(ids: string[]): number {
  let count = 0;
  for (const id of ids) {
    const filter = getFilter(id);
    if (!filter || filter.enabled) continue;
    saveFilter({ ...filter, enabled: true });
    count += 1;
  }
  return count;
}

function rowToWatch(r: Record<string, unknown>): WishlistWatch {
  return {
    id: String(r.id),
    name: String(r.name),
    enabled: Boolean(r.enabled),
    query: String(r.query || ''),
    author: String(r.author || ''),
    series: String(r.series || ''),
    narrator: String(r.narrator || ''),
    mediaTypes: parseJson(String(r.media_types || '[]'), ['eBook', 'Audiobook']),
    formats: parseJson(String(r.formats || '[]'), []),
    intervalMinutes: Number(r.interval_minutes || 30),
    lastRunAt: (r.last_run_at as string) || null,
    lastResult: String(r.last_result || ''),
  };
}

export function listWatches(): WishlistWatch[] {
  const rows = getDb()
    .prepare('SELECT * FROM wishlist_watches ORDER BY name ASC')
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToWatch);
}

export function getWatch(id: string): WishlistWatch | null {
  const row = getDb().prepare('SELECT * FROM wishlist_watches WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToWatch(row) : null;
}

export function saveWatch(input: Partial<WishlistWatch> & { name?: string }): WishlistWatch {
  const id = input.id || randomUUID();
  const existing = getWatch(id);
  const watch: WishlistWatch = {
    id,
    name: input.name ?? existing?.name ?? 'Untitled Watch',
    enabled: input.enabled ?? existing?.enabled ?? true,
    query: input.query ?? existing?.query ?? '',
    author: input.author ?? existing?.author ?? '',
    series: input.series ?? existing?.series ?? '',
    narrator: input.narrator ?? existing?.narrator ?? '',
    mediaTypes: input.mediaTypes ?? existing?.mediaTypes ?? ['eBook', 'Audiobook'],
    formats: input.formats ?? existing?.formats ?? [],
    intervalMinutes: input.intervalMinutes ?? existing?.intervalMinutes ?? 30,
    lastRunAt: input.lastRunAt ?? existing?.lastRunAt ?? null,
    lastResult: input.lastResult ?? existing?.lastResult ?? '',
  };

  getDb()
    .prepare(
      `INSERT INTO wishlist_watches (
        id, name, enabled, query, author, series, narrator, media_types, formats,
        interval_minutes, last_run_at, last_result, updated_at
      ) VALUES (
        @id, @name, @enabled, @query, @author, @series, @narrator, @media_types, @formats,
        @interval_minutes, @last_run_at, @last_result, datetime('now')
      )
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, enabled=excluded.enabled, query=excluded.query,
        author=excluded.author, series=excluded.series, narrator=excluded.narrator,
        media_types=excluded.media_types, formats=excluded.formats,
        interval_minutes=excluded.interval_minutes, last_run_at=excluded.last_run_at,
        last_result=excluded.last_result, updated_at=datetime('now')`
    )
    .run({
      id: watch.id,
      name: watch.name,
      enabled: watch.enabled ? 1 : 0,
      query: watch.query,
      author: watch.author,
      series: watch.series,
      narrator: watch.narrator,
      media_types: JSON.stringify(watch.mediaTypes),
      formats: JSON.stringify(watch.formats),
      interval_minutes: watch.intervalMinutes,
      last_run_at: watch.lastRunAt,
      last_result: watch.lastResult,
    });

  return watch;
}

export function deleteWatch(id: string): void {
  getDb().prepare('DELETE FROM wishlist_watches WHERE id = ?').run(id);
}

export function markSeen(torrentId: string, title: string, source: string): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO seen_torrents (torrent_id, title, source) VALUES (?, ?, ?)`
    )
    .run(torrentId, title, source);
}

export function hasSeen(torrentId: string): boolean {
  const row = getDb()
    .prepare('SELECT torrent_id FROM seen_torrents WHERE torrent_id = ?')
    .get(torrentId);
  return Boolean(row);
}

export type SnatchBackoff = {
  torrentId: string;
  attempts: number;
  lastError: string;
  retryAfter: string;
  updatedAt: string;
};

function backoffDelayMs(attempts: number): number {
  // 15m → 1h → 6h → 24h (cap)
  const minutes = [15, 60, 360, 1440];
  const idx = Math.min(Math.max(attempts, 1), minutes.length) - 1;
  const override = Number(process.env.SNATCH_ERROR_BACKOFF_MINUTES || 0);
  if (override > 0 && attempts === 1) return override * 60 * 1000;
  return minutes[idx] * 60 * 1000;
}

export function getSnatchBackoff(torrentId: string): SnatchBackoff | null {
  const row = getDb()
    .prepare('SELECT * FROM snatch_backoff WHERE torrent_id = ?')
    .get(torrentId) as
    | {
        torrent_id: string;
        attempts: number;
        last_error: string;
        retry_after: string;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    torrentId: row.torrent_id,
    attempts: Number(row.attempts) || 1,
    lastError: row.last_error || '',
    retryAfter: row.retry_after,
    updatedAt: row.updated_at,
  };
}

/** Returns active backoff if retry_after is still in the future. */
export function getActiveSnatchBackoff(torrentId: string): SnatchBackoff | null {
  const row = getSnatchBackoff(torrentId);
  if (!row) return null;
  const until = Date.parse(row.retryAfter);
  if (Number.isNaN(until) || until <= Date.now()) return null;
  return row;
}

export function recordSnatchBackoff(torrentId: string, error: string): SnatchBackoff {
  const existing = getSnatchBackoff(torrentId);
  const attempts = (existing?.attempts || 0) + 1;
  const retryAfter = new Date(Date.now() + backoffDelayMs(attempts)).toISOString();
  getDb()
    .prepare(
      `INSERT INTO snatch_backoff (torrent_id, attempts, last_error, retry_after, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(torrent_id) DO UPDATE SET
         attempts = excluded.attempts,
         last_error = excluded.last_error,
         retry_after = excluded.retry_after,
         updated_at = datetime('now')`
    )
    .run(torrentId, attempts, (error || '').slice(0, 500), retryAfter);
  return getSnatchBackoff(torrentId)!;
}

export function clearSnatchBackoff(torrentId: string): void {
  getDb().prepare('DELETE FROM snatch_backoff WHERE torrent_id = ?').run(torrentId);
}

export function clearAllSnatchBackoff(): number {
  const r = getDb().prepare('DELETE FROM snatch_backoff').run();
  return Number(r.changes || 0);
}

export function insertSnatch(record: Omit<SnatchRecord, 'createdAt'> & { createdAt?: string }): void {
  getDb()
    .prepare(
      `INSERT INTO snatches (
        id, torrent_id, title, author, series, media_type, format, source,
        filter_id, filter_name, status, error, client_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.torrentId,
      record.title,
      record.author,
      record.series,
      record.mediaType,
      record.format,
      record.source,
      record.filterId,
      record.filterName,
      record.status,
      record.error,
      record.clientMessage
    );
}

export function listSnatches(limit = 100): SnatchRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM snatches ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    torrentId: String(r.torrent_id),
    title: String(r.title),
    author: String(r.author || ''),
    series: String(r.series || ''),
    mediaType: String(r.media_type || ''),
    format: String(r.format || ''),
    source: String(r.source || ''),
    filterId: (r.filter_id as string) || null,
    filterName: (r.filter_name as string) || null,
    status: String(r.status),
    error: (r.error as string) || null,
    clientMessage: (r.client_message as string) || null,
    createdAt: String(r.created_at),
  }));
}

export function insertEvent(type: string, payload: unknown): void {
  getDb()
    .prepare('INSERT INTO events (type, payload) VALUES (?, ?)')
    .run(type, JSON.stringify(payload));
  // Keep last 500 events
  getDb()
    .prepare(
      `DELETE FROM events WHERE id NOT IN (
        SELECT id FROM events ORDER BY id DESC LIMIT 500
      )`
    )
    .run();
}

export function listEvents(limit = 100): Array<{ id: number; type: string; payload: unknown; createdAt: string }> {
  const rows = getDb()
    .prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?')
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: Number(r.id),
    type: String(r.type),
    payload: parseJson(String(r.payload), {}),
    createdAt: String(r.created_at),
  }));
}

export function snatchCount(): number {
  const row = getDb().prepare('SELECT COUNT(*) as c FROM snatches WHERE status = ?').get('success') as {
    c: number;
  };
  return row.c;
}
