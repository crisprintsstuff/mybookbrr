import { searchTorrents } from '../mam/client.js';
import { getSetting } from '../db/index.js';
import { listWatches, saveWatch } from '../db/repos.js';
import { processRelease, eventBus } from '../snatch/orchestrator.js';
import { mamHitToRelease, mediaTypesToMainCats, watchMatchesRelease } from './matcher.js';
import { alertMamSessionDead, alertWishlistError, isMamSessionError } from '../notify/alerts.js';
import type { WishlistWatch } from '../types.js';

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastPollAt: string | null = null;
let lastPollResult = '';

export function getWishlistStatus() {
  return {
    enabled: getSetting('wishlist_poll_enabled') !== 'false',
    running,
    lastPollAt,
    lastPollResult,
  };
}

async function runWatch(watch: WishlistWatch): Promise<{ found: number; snatched: number; errors: number }> {
  const text = [watch.query, watch.author, watch.series, watch.narrator].filter(Boolean).join(' ').trim();
  const result = await searchTorrents({
    text: text || undefined,
    mainCat: mediaTypesToMainCats(watch.mediaTypes),
    perPage: 50,
    sortType: 'dateDesc',
  });

  let snatched = 0;
  let errors = 0;
  let found = 0;

  for (const hit of result.data) {
    const release = mamHitToRelease(hit, 'wishlist');
    if (!release) continue;
    if (!watchMatchesRelease(watch, release)) continue;
    found += 1;
    const out = await processRelease(release);
    if (out.snatched) snatched += 1;
    else if (!out.skipped) errors += 1;
    await sleep(400);
  }

  const summary = `found=${found} snatched=${snatched} errors=${errors} results=${result.data.length}`;
  saveWatch({
    ...watch,
    lastRunAt: new Date().toISOString(),
    lastResult: summary,
  });
  return { found, snatched, errors };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function pollWishlistOnce(): Promise<void> {
  if (running) return;
  if (getSetting('wishlist_poll_enabled') === 'false') return;
  running = true;
  lastPollAt = new Date().toISOString();
  try {
    const watches = listWatches().filter((w) => w.enabled);
    let totalSnatched = 0;
    for (const watch of watches) {
      const due = isDue(watch);
      if (!due) continue;
      try {
        const r = await runWatch(watch);
        totalSnatched += r.snatched;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        saveWatch({ ...watch, lastRunAt: new Date().toISOString(), lastResult: `error: ${msg}` });
        eventBus.broadcast('wishlist_error', { watchId: watch.id, error: msg });
        if (isMamSessionError(err)) {
          void alertMamSessionDead(msg, 'Wishlist');
        } else {
          void alertWishlistError(watch.id, msg);
        }
      }
      await sleep(1500);
    }
    lastPollResult = `ok watches=${watches.length} snatched=${totalSnatched}`;
    eventBus.broadcast('wishlist_poll', { at: lastPollAt, result: lastPollResult });
  } finally {
    running = false;
  }
}

function isDue(watch: WishlistWatch): boolean {
  if (!watch.lastRunAt) return true;
  const last = Date.parse(watch.lastRunAt);
  if (Number.isNaN(last)) return true;
  const intervalMs = Math.max(5, watch.intervalMinutes || 30) * 60 * 1000;
  return Date.now() - last >= intervalMs;
}

export function startWishlistPoller(): void {
  if (timer) return;
  // Initial delay, then every 2 minutes check due watches
  setTimeout(() => {
    void pollWishlistOnce();
  }, 5000);
  timer = setInterval(() => {
    void pollWishlistOnce();
  }, 2 * 60 * 1000);
}

export function stopWishlistPoller(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runWatchNow(watchId: string): Promise<{ found: number; snatched: number; errors: number }> {
  const watch = listWatches().find((w) => w.id === watchId);
  if (!watch) throw new Error('Watch not found');
  return runWatch(watch);
}
