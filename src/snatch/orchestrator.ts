import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { evaluateRelease } from '../filters/evaluator.js';
import { downloadTorrent, isUnsatisfiedLimitError } from '../mam/client.js';
import { addTorrentFile, writeWatchFolder } from '../clients/qbittorrent.js';
import { notifyReleaseStream, notifySnatchError, notifySnatchSuccess } from '../notify/discord.js';
import { alertMamSessionDead, isMamSessionError } from '../notify/alerts.js';
import {
  bumpFilterSnatch,
  clearSnatchBackoff,
  getActiveSnatchBackoff,
  hasSeen,
  insertEvent,
  insertSnatch,
  listFilters,
  markSeen,
  recordSnatchBackoff,
  snatchCount,
} from '../db/repos.js';
import { getSetting, setSetting } from '../db/index.js';
import { handleUnsatisfiedLimit, getUnsatisfiedStatus } from '../filters/unsatisfiedGuard.js';
import { getTimedLockoutStatus } from '../filters/timedLockout.js';
import type { FilterRule, Release } from '../types.js';

/** Remove a staging .torrent after the client has accepted it (never the watch-folder copy). */
function removeStagingTorrent(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (err) {
    console.warn(`[Snatch] Failed to delete staging torrent ${filePath}:`, err);
  }
}

/** Rejects caused by lockout / no enabled filters must not permanently burn the tid. */
function isTransientFilterReject(reasons: string[], lockoutActive: boolean): boolean {
  if (lockoutActive) return true;
  return reasons.some((r) =>
    /no active filter|no enabled filter|filters were turned off|unsatisfied/i.test(r)
  );
}

export interface ProcessOptions {
  skipFilters?: boolean;
  force?: boolean;
  filterOverride?: FilterRule | null;
  /** When true, skip Discord release-stream embed (e.g. manual search snatch). */
  quietStream?: boolean;
}

export interface ProcessResult {
  snatched: boolean;
  skipped: boolean;
  reason: string;
  evaluation?: ReturnType<typeof evaluateRelease>;
  release: Release;
}

class EventBus extends EventEmitter {
  broadcast(type: string, payload: unknown): void {
    insertEvent(type, payload);
    this.emit('event', { type, payload, createdAt: new Date().toISOString() });
  }
}

export const eventBus = new EventBus();

export async function processRelease(
  release: Release,
  options: ProcessOptions = {}
): Promise<ProcessResult> {
  eventBus.broadcast('announce', {
    release,
    at: new Date().toISOString(),
  });

  if (!release.torrentId) {
    return { snatched: false, skipped: true, reason: 'Missing torrent ID', release };
  }

  if (!options.force && hasSeen(release.torrentId)) {
    const reason = `Already seen torrent ${release.torrentId}`;
    eventBus.broadcast('skip', { release, reason });
    return { snatched: false, skipped: true, reason, release };
  }

  if (!options.force) {
    const backoff = getActiveSnatchBackoff(release.torrentId);
    if (backoff) {
      const reason = `Backoff until ${backoff.retryAfter} (attempt ${backoff.attempts}): ${backoff.lastError || 'previous snatch error'}`;
      eventBus.broadcast('skip', { release, reason, backoff: true });
      return { snatched: false, skipped: true, reason, release };
    }
  }

  // During MAM unsatisfied or manual timed lockout, do not evaluate/reject (would permanently markSeen).
  // Manual/force snatches can still proceed.
  const unsatisfied = getUnsatisfiedStatus();
  const timed = getTimedLockoutStatus();
  const lockoutActive = unsatisfied.active || timed.active;
  if (lockoutActive && !options.force && !options.skipFilters) {
    const reason = unsatisfied.active
      ? 'Skipped: MAM unsatisfied lockout active — clear the lockout before auto-snatching again'
      : `Skipped: manual MAM lockout until ${timed.until} — filters will re-enable automatically`;
    eventBus.broadcast('skip', {
      release,
      reason,
      lockout: true,
      timedLockout: timed.active,
      unsatisfiedLockout: unsatisfied.active,
    });
    return { snatched: false, skipped: true, reason, release };
  }
  const lockout = { active: lockoutActive };

  // Release stream: new IRC/wishlist announces (not manual one-clicks).
  if (!options.quietStream && release.source !== 'manual') {
    void notifyReleaseStream(release);
  }

  let matchedFilter: FilterRule | null = options.filterOverride || null;
  let evaluation = evaluateRelease(release, listFilters());

  if (!options.skipFilters && !options.filterOverride) {
    if (!evaluation.matched || !evaluation.matchedFilter) {
      const transient = isTransientFilterReject(evaluation.reasons, lockout.active);
      if (!transient) {
        markSeen(release.torrentId, release.title, release.source);
      }
      eventBus.broadcast('reject', {
        release,
        reasons: evaluation.reasons,
        evaluationLog: evaluation.evaluationLog,
        markedSeen: !transient,
      });
      return {
        snatched: false,
        skipped: true,
        reason: evaluation.reasons.join('; '),
        evaluation,
        release,
      };
    }
    matchedFilter = evaluation.matchedFilter;
  }

  const clientType =
    matchedFilter?.clientType ||
    (getSetting('download_client') as 'qbittorrent' | 'watchfolder') ||
    'qbittorrent';
  const category = matchedFilter?.clientCategory || getSetting('qbit_category') || 'books';
  const savePath = matchedFilter?.savePath || getSetting('qbit_save_path') || '';

  try {
    const dl = await downloadTorrent(release.torrentId);

    let clientMessage = '';
    if (clientType === 'watchfolder') {
      const w = writeWatchFolder(dl.buffer, dl.filename);
      clientMessage = w.message;
    } else {
      const q = await addTorrentFile(dl.buffer, dl.filename, { category, savePath });
      clientMessage = q.message;
    }
    // Drop any staging file under DOWNLOADS_DIR once the client has the torrent.
    // Watch-folder delivery keeps its own copy in the watch directory.
    removeStagingTorrent(dl.filePath);

    markSeen(release.torrentId, release.title, release.source);
    clearSnatchBackoff(release.torrentId);
    if (matchedFilter) bumpFilterSnatch(matchedFilter.id);

    insertSnatch({
      id: randomUUID(),
      torrentId: release.torrentId,
      title: release.title,
      author: release.author,
      series: release.series,
      mediaType: release.mediaType,
      format: release.format,
      source: release.source,
      filterId: matchedFilter?.id || null,
      filterName: matchedFilter?.name || null,
      status: 'success',
      error: null,
      clientMessage,
    });

    setSetting('snatch_count_total', String(snatchCount()));

    await notifySnatchSuccess(release, matchedFilter, clientMessage, {
      category,
      savePath,
      clientType,
    });

    eventBus.broadcast('snatch', {
      release,
      filter: matchedFilter?.name || null,
      clientMessage,
    });

    return {
      snatched: true,
      skipped: false,
      reason: clientMessage,
      evaluation,
      release,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (isUnsatisfiedLimitError(err)) {
      const guard = await handleUnsatisfiedLimit({
        torrentId: release.torrentId,
        title: release.title,
      });
      const reason = `${message} ${guard.detail}`;
      // Do not permanently markSeen — after lockout clears this tid should be retryable.
      // Use backoff so wishlist/IRC does not hammer MAM while locked out.
      const backoff = recordSnatchBackoff(release.torrentId, reason);
      insertSnatch({
        id: randomUUID(),
        torrentId: release.torrentId,
        title: release.title,
        author: release.author,
        series: release.series,
        mediaType: release.mediaType,
        format: release.format,
        source: release.source,
        filterId: matchedFilter?.id || null,
        filterName: matchedFilter?.name || null,
        status: 'error',
        error: `${reason} (backoff until ${backoff.retryAfter})`,
        clientMessage: null,
      });
      await notifySnatchError(release, matchedFilter?.name || null, reason);
      eventBus.broadcast('unsatisfied_limit', {
        at: new Date().toISOString(),
        disabledFilterIds: guard.disabledIds,
        autoDisable: guard.autoDisable,
        torrentId: release.torrentId,
        title: release.title,
        detail: guard.detail,
      });
      eventBus.broadcast('error', {
        release,
        error: reason,
        unsatisfiedLimit: true,
        backoffUntil: backoff.retryAfter,
      });
      return {
        snatched: false,
        skipped: false,
        reason,
        evaluation,
        release,
      };
    }

    const backoff = recordSnatchBackoff(release.torrentId, message);
    insertSnatch({
      id: randomUUID(),
      torrentId: release.torrentId,
      title: release.title,
      author: release.author,
      series: release.series,
      mediaType: release.mediaType,
      format: release.format,
      source: release.source,
      filterId: matchedFilter?.id || null,
      filterName: matchedFilter?.name || null,
      status: 'error',
      error: `${message} (backoff until ${backoff.retryAfter}, attempt ${backoff.attempts})`,
      clientMessage: null,
    });
    await notifySnatchError(release, matchedFilter?.name || null, message);
    if (isMamSessionError(err)) {
      void alertMamSessionDead(message, 'Snatch');
    }
    eventBus.broadcast('error', {
      release,
      error: message,
      backoffUntil: backoff.retryAfter,
      backoffAttempts: backoff.attempts,
    });
    return {
      snatched: false,
      skipped: false,
      reason: message,
      evaluation,
      release,
    };
  }
}
