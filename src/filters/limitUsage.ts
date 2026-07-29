import type { FilterRule } from '../types.js';

export type LimitPeriod = FilterRule['limitPeriod'];

export interface LimitUsage {
  /** Snatches in the current period window (0 if unlimited). */
  used: number;
  /** Max allowed in the period (0 if unlimited). */
  max: number;
  period: LimitPeriod;
  atLimit: boolean;
  /** Earliest timestamp when the oldest snatch in-window falls out (ms since epoch). */
  resetsAtMs: number | null;
  resetsAt: string | null;
}

export function windowMs(period: LimitPeriod): number {
  switch (period) {
    case 'daily':
      return 24 * 60 * 60 * 1000;
    case 'weekly':
      return 7 * 24 * 60 * 60 * 1000;
    case 'monthly':
      return 30 * 24 * 60 * 60 * 1000;
    default:
      return 0;
  }
}

/** Period-window usage for a filter (same math as the evaluator). */
export function getLimitUsage(filter: FilterRule, now = Date.now()): LimitUsage {
  const period = filter.limitPeriod || 'unlimited';
  const max = Number(filter.maxDownloads || 0);

  if (period === 'unlimited' || max <= 0) {
    return {
      used: 0,
      max: 0,
      period: 'unlimited',
      atLimit: false,
      resetsAtMs: null,
      resetsAt: null,
    };
  }

  const ms = windowMs(period);
  const recent = (filter.snatchHistoryTimestamps || [])
    .filter((ts) => now - ts < ms)
    .sort((a, b) => a - b);
  const used = recent.length;
  const atLimit = used >= max;

  // Reset when the oldest in-window snatch ages out of the sliding window.
  let resetsAtMs: number | null = null;
  if (recent.length > 0) {
    // If at limit, reset when enough oldest drop so used < max (when oldest expires).
    // Approximate: next free slot when the (used - max + 1)th oldest expires — at limit that's the oldest.
    const indexToExpire = Math.max(0, used - max);
    resetsAtMs = recent[indexToExpire] + ms;
  }

  return {
    used,
    max,
    period,
    atLimit,
    resetsAtMs,
    resetsAt: resetsAtMs != null ? new Date(resetsAtMs).toISOString() : null,
  };
}

export type FilterWithLimit = FilterRule & {
  limitUsed: number;
  limitMax: number;
  atLimit: boolean;
  resetsAt: string | null;
};

export function enrichFilterWithLimit(filter: FilterRule, now = Date.now()): FilterWithLimit {
  const usage = getLimitUsage(filter, now);
  return {
    ...filter,
    limitUsed: usage.used,
    limitMax: usage.max,
    atLimit: usage.atLimit,
    resetsAt: usage.resetsAt,
  };
}

/**
 * Filters that are **operationally** at their download cap (enabled only).
 * Disabled filters keep historical usage for the UI, but must not drive banners/alerts.
 */
export function listFiltersAtLimit(
  filters: FilterRule[],
  now = Date.now()
): Array<{
  id: string;
  name: string;
  used: number;
  max: number;
  period: LimitPeriod;
  resetsAt: string | null;
  enabled: boolean;
}> {
  return filters
    .map((f) => {
      if (!f.enabled) return null;
      const u = getLimitUsage(f, now);
      if (!u.atLimit) return null;
      return {
        id: f.id,
        name: f.name,
        used: u.used,
        max: u.max,
        period: u.period,
        resetsAt: u.resetsAt,
        enabled: true,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
}

/** In-memory cooldown so re-announces don't spam Discord when a filter is capped. */
const limitNotifyCooldown = new Map<string, number>();
const LIMIT_NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

export function shouldNotifyLimitHit(filterId: string, now = Date.now()): boolean {
  const last = limitNotifyCooldown.get(filterId) || 0;
  if (now - last < LIMIT_NOTIFY_COOLDOWN_MS) return false;
  limitNotifyCooldown.set(filterId, now);
  return true;
}

export function formatLimitSummary(usage: LimitUsage): string {
  if (usage.period === 'unlimited' || usage.max <= 0) return 'no limit';
  return `${usage.used}/${usage.max} ${usage.period}`;
}

export function formatResetsIn(resetsAtMs: number | null, now = Date.now()): string {
  if (resetsAtMs == null) return '';
  const ms = Math.max(0, resetsAtMs - now);
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const mins = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    return `~${days}d`;
  }
  if (hours > 0) return `~${hours}h ${mins}m`;
  return `~${mins}m`;
}
