import { getSetting, setSettings } from '../db/index.js';
import {
  clearAllSnatchBackoff,
  disableAllEnabledFilters,
  enableFiltersByIds,
  listFilters,
} from '../db/repos.js';
import { notifySystemError } from '../notify/discord.js';

/** Lazy import avoids circular dependency with orchestrator. */
function broadcast(type: string, payload: unknown): void {
  void import('../snatch/orchestrator.js')
    .then(({ eventBus }) => eventBus.broadcast(type, payload))
    .catch((err) => console.warn('[Filters] timed lockout broadcast failed:', err));
}

export interface TimedLockoutStatus {
  active: boolean;
  until: string | null;
  remainingMs: number | null;
  disabledFilterIds: string[];
  note: string | null;
  message: string | null;
}

function parseIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseUntil(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * If a timed lockout is past `until`, clear it and re-enable saved filters.
 * Safe to call often (processRelease + interval).
 */
export function expireTimedLockoutIfNeeded(): {
  expired: boolean;
  reenabled: number;
  until: string | null;
} {
  const untilRaw = getSetting('mam_timed_lockout_until') || '';
  if (!untilRaw) {
    return { expired: false, reenabled: 0, until: null };
  }
  const until = parseUntil(untilRaw);
  if (!until) {
    // Corrupt value — clear without re-enable to avoid surprises
    setSettings({
      mam_timed_lockout_until: '',
      mam_timed_lockout_disabled_filters: '[]',
      mam_timed_lockout_note: '',
    });
    return { expired: true, reenabled: 0, until: null };
  }
  if (Date.now() < until.getTime()) {
    return { expired: false, reenabled: 0, until: until.toISOString() };
  }

  const ids = parseIds(getSetting('mam_timed_lockout_disabled_filters'));
  const reenabled = ids.length ? enableFiltersByIds(ids) : 0;
  const clearedBackoffs = clearAllSnatchBackoff();
  setSettings({
    mam_timed_lockout_until: '',
    mam_timed_lockout_disabled_filters: '[]',
    mam_timed_lockout_note: '',
  });
  broadcast('timed_lockout_expired', {
    at: new Date().toISOString(),
    until: until.toISOString(),
    reenabled,
    clearedBackoffs,
  });
  console.log(
    `[Filters] Timed MAM lockout expired — re-enabled ${reenabled} filter(s), cleared ${clearedBackoffs} backoff(s)`
  );
  return { expired: true, reenabled, until: until.toISOString() };
}

export function getTimedLockoutStatus(): TimedLockoutStatus {
  expireTimedLockoutIfNeeded();
  const untilRaw = getSetting('mam_timed_lockout_until') || '';
  const until = parseUntil(untilRaw);
  const active = Boolean(until && until.getTime() > Date.now());
  const remainingMs = active && until ? Math.max(0, until.getTime() - Date.now()) : null;
  const note = getSetting('mam_timed_lockout_note') || null;
  return {
    active,
    until: active && until ? until.toISOString() : null,
    remainingMs,
    disabledFilterIds: active ? parseIds(getSetting('mam_timed_lockout_disabled_filters')) : [],
    note: active ? note : null,
    message: active
      ? `Manual MAM lockout until ${until!.toISOString()}${note ? ` — ${note}` : ''}. Filters paused; will auto re-enable when the timer ends.`
      : null,
  };
}

export async function setTimedLockout(opts: {
  until: string | Date;
  note?: string;
  disableFilters?: boolean;
}): Promise<TimedLockoutStatus> {
  const until = opts.until instanceof Date ? opts.until : parseUntil(opts.until);
  if (!until || until.getTime() <= Date.now()) {
    throw new Error('until must be a future datetime (ISO-8601)');
  }

  const disableFilters = opts.disableFilters !== false;
  let disabledIds = parseIds(getSetting('mam_timed_lockout_disabled_filters'));
  if (disableFilters) {
    const newlyDisabled = disableAllEnabledFilters();
    disabledIds = Array.from(new Set([...disabledIds, ...newlyDisabled]));
  }

  const note = (opts.note || '').trim().slice(0, 500);
  setSettings({
    mam_timed_lockout_until: until.toISOString(),
    mam_timed_lockout_disabled_filters: JSON.stringify(disabledIds),
    mam_timed_lockout_note: note,
  });

  broadcast('timed_lockout_set', {
    at: new Date().toISOString(),
    until: until.toISOString(),
    disabledFilterIds: disabledIds,
    note: note || null,
  });

  await notifySystemError(
    'Manual MAM lockout set',
    `Auto-snatch paused until ${until.toISOString()}. Disabled ${disabledIds.length} filter(s).${
      note ? ` Note: ${note}` : ''
    } Filters will re-enable automatically when the timer ends.`,
    'Timed lockout'
  );

  console.warn(
    `[Filters] Timed MAM lockout until ${until.toISOString()} — disabled ${disabledIds.length} filter(s)`
  );
  return getTimedLockoutStatus();
}

export function clearTimedLockout(reenableFilters: boolean): {
  cleared: boolean;
  reenabled: number;
  enabledCount: number;
  clearedBackoffs: number;
} {
  const ids = parseIds(getSetting('mam_timed_lockout_disabled_filters'));
  let reenabled = 0;
  if (reenableFilters && ids.length) {
    reenabled = enableFiltersByIds(ids);
  }
  setSettings({
    mam_timed_lockout_until: '',
    mam_timed_lockout_disabled_filters: '[]',
    mam_timed_lockout_note: '',
  });
  const clearedBackoffs = clearAllSnatchBackoff();
  broadcast('timed_lockout_cleared', {
    at: new Date().toISOString(),
    reenabled,
    clearedBackoffs,
  });
  return {
    cleared: true,
    reenabled,
    enabledCount: listFilters().filter((f) => f.enabled).length,
    clearedBackoffs,
  };
}

/** Periodic expire check (server boot). */
export function startTimedLockoutScheduler(): void {
  const tick = () => {
    try {
      expireTimedLockoutIfNeeded();
    } catch (err) {
      console.error('[Filters] Timed lockout tick failed:', err);
    }
  };
  tick();
  setInterval(tick, 15_000);
}
