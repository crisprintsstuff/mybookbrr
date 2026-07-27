import { getSetting } from '../db/index.js';
import { testQbittorrent } from './qbittorrent.js';

export type QbitHealth = {
  /** true when client is qbittorrent and probe succeeded; null when not using qBit */
  ok: boolean | null;
  applicable: boolean;
  message: string;
  version?: string;
  checkedAt: string | null;
};

type Cache = {
  at: number;
  result: QbitHealth;
};

let cache: Cache | null = null;
const TTL_MS = 30_000;

export function getDownloadClient(): 'qbittorrent' | 'watchfolder' {
  const raw = (getSetting('download_client') || 'qbittorrent').toLowerCase();
  return raw === 'watchfolder' ? 'watchfolder' : 'qbittorrent';
}

/** Cached qBittorrent connectivity probe (~30s). */
export async function getQbitHealth(force = false): Promise<QbitHealth> {
  const client = getDownloadClient();
  if (client !== 'qbittorrent') {
    return {
      ok: null,
      applicable: false,
      message: 'Download client is watch folder (qBit not used)',
      checkedAt: null,
    };
  }

  const now = Date.now();
  if (!force && cache && now - cache.at < TTL_MS) {
    return cache.result;
  }

  const probe = await testQbittorrent();
  const result: QbitHealth = {
    ok: probe.ok,
    applicable: true,
    message: probe.message,
    version: probe.version,
    checkedAt: new Date().toISOString(),
  };
  cache = { at: now, result };
  return result;
}

/** Sync snapshot of last probe (may be stale/null before first check). */
export function getCachedQbitHealth(): QbitHealth | null {
  return cache?.result ?? null;
}
