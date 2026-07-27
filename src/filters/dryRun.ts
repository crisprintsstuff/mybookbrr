import type { FilterRule, Release } from '../types.js';
import { evaluateRelease } from './evaluator.js';
import { listEvents } from '../db/repos.js';

export type DryRunResult = {
  filterId: string;
  filterName: string;
  scanned: number;
  wouldMatch: number;
  blockedByLimit: number;
  noMatch: number;
  sampleMatches: Array<{ title: string; author: string; torrentId: string; at?: string }>;
  sampleBlocked: Array<{ title: string; reason: string }>;
};

function releaseFromPayload(payload: unknown): Release | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const release = (p.release || p) as Record<string, unknown>;
  if (!release || typeof release !== 'object') return null;
  const torrentId = String(release.torrentId || release.torrent_id || '');
  if (!torrentId) return null;
  return {
    torrentId,
    title: String(release.title || `Torrent ${torrentId}`),
    author: String(release.author || 'Unknown'),
    series: String(release.series || ''),
    narrator: String(release.narrator || ''),
    mediaType: release.mediaType === 'Audiobook' ? 'Audiobook' : 'eBook',
    format: String(release.format || 'EPUB'),
    sizeMB: Number(release.sizeMB || 0),
    sizeStr: String(release.sizeStr || ''),
    freeleech: Boolean(release.freeleech),
    vip: Boolean(release.vip),
    bitrate: Number(release.bitrate || 0),
    torrentUrl: String(release.torrentUrl || ''),
    source: (release.source as Release['source']) || 'irc',
    raw: String(release.raw || ''),
    year: release.year ? String(release.year) : undefined,
    category: release.category ? String(release.category) : undefined,
  };
}

/**
 * Re-evaluate a filter against recent announce events (ignores other filters).
 * Rate limits still apply for "blocked by limit" vs pure match (ignoreLimits).
 */
export function dryRunFilter(
  filter: FilterRule,
  opts?: { limit?: number; ignoreLimits?: boolean }
): DryRunResult {
  const limit = Math.min(500, Math.max(10, opts?.limit ?? 100));
  const ignoreLimits = opts?.ignoreLimits !== false;
  const probe: FilterRule = ignoreLimits
    ? { ...filter, enabled: true, limitPeriod: 'unlimited', maxDownloads: 0 }
    : { ...filter, enabled: true };

  const events = listEvents(limit * 2);
  const seen = new Set<string>();
  let scanned = 0;
  let wouldMatch = 0;
  let blockedByLimit = 0;
  let noMatch = 0;
  const sampleMatches: DryRunResult['sampleMatches'] = [];
  const sampleBlocked: DryRunResult['sampleBlocked'] = [];

  for (const ev of events) {
    if (scanned >= limit) break;
    if (!['announce', 'reject', 'snatch', 'skip'].includes(ev.type)) continue;
    const release = releaseFromPayload(ev.payload);
    if (!release) continue;
    if (seen.has(release.torrentId)) continue;
    seen.add(release.torrentId);
    scanned += 1;

    const withLimits = evaluateRelease(release, [{ ...filter, enabled: true }]);
    const pure = ignoreLimits ? evaluateRelease(release, [probe]) : withLimits;

    if (pure.matched) {
      // pure match ignoring limits
      const limitOnly =
        ignoreLimits &&
        !withLimits.matched &&
        withLimits.evaluationLog.some((e) =>
          (e.failures || []).some((f) => /download limit reached/i.test(f))
        );
      if (limitOnly) {
        blockedByLimit += 1;
        if (sampleBlocked.length < 5) {
          sampleBlocked.push({
            title: release.title,
            reason: 'Would match rules but filter is at download limit',
          });
        }
      } else if (withLimits.matched || ignoreLimits) {
        wouldMatch += 1;
        if (sampleMatches.length < 8) {
          sampleMatches.push({
            title: release.title,
            author: release.author,
            torrentId: release.torrentId,
            at: ev.createdAt,
          });
        }
      } else {
        noMatch += 1;
      }
    } else {
      noMatch += 1;
    }
  }

  return {
    filterId: filter.id,
    filterName: filter.name,
    scanned,
    wouldMatch,
    blockedByLimit,
    noMatch,
    sampleMatches,
    sampleBlocked,
  };
}
