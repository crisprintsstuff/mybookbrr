import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { evaluateRelease } from '../filters/evaluator.js';
import { downloadTorrent, isUnsatisfiedLimitError } from '../mam/client.js';
import { addTorrentFile, writeWatchFolder } from '../clients/qbittorrent.js';
import { notifyReleaseStream, notifySnatchError, notifySnatchSuccess } from '../notify/discord.js';
import {
  bumpFilterSnatch,
  hasSeen,
  insertEvent,
  insertSnatch,
  listFilters,
  markSeen,
  snatchCount,
} from '../db/repos.js';
import { getSetting, setSetting } from '../db/index.js';
import { handleUnsatisfiedLimit } from '../filters/unsatisfiedGuard.js';
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

  // Release stream: new IRC/wishlist announces (not manual one-clicks).
  if (!options.quietStream && release.source !== 'manual') {
    void notifyReleaseStream(release);
  }

  let matchedFilter: FilterRule | null = options.filterOverride || null;
  let evaluation = evaluateRelease(release, listFilters());

  if (!options.skipFilters && !options.filterOverride) {
    if (!evaluation.matched || !evaluation.matchedFilter) {
      markSeen(release.torrentId, release.title, release.source);
      eventBus.broadcast('reject', {
        release,
        reasons: evaluation.reasons,
        evaluationLog: evaluation.evaluationLog,
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
        error: reason,
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
      eventBus.broadcast('error', { release, error: reason, unsatisfiedLimit: true });
      return {
        snatched: false,
        skipped: false,
        reason,
        evaluation,
        release,
      };
    }

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
      error: message,
      clientMessage: null,
    });
    await notifySnatchError(release, matchedFilter?.name || null, message);
    eventBus.broadcast('error', { release, error: message });
    return {
      snatched: false,
      skipped: false,
      reason: message,
      evaluation,
      release,
    };
  }
}
