import { getSetting } from '../db/index.js';
import { listFilters, snatchCount } from '../db/repos.js';
import { getQbitHealth, type QbitHealth } from '../clients/qbitHealth.js';
import { getTimedLockoutStatus } from '../filters/timedLockout.js';
import { getUnsatisfiedStatus } from '../filters/unsatisfiedGuard.js';
import { listFiltersAtLimit } from '../filters/limitUsage.js';
import { ircListener } from '../irc/listener.js';
import { getWishlistStatus } from '../wishlist/poller.js';

export async function buildStatusPayload() {
  let lastAnnounce: unknown = null;
  try {
    const raw = getSetting('last_announce');
    lastAnnounce = raw ? JSON.parse(raw) : null;
  } catch {
    lastAnnounce = null;
  }
  const ircDesired = getSetting('irc_enabled') === 'true';
  const filters = listFilters();
  const filtersAtLimit = listFiltersAtLimit(filters);
  const qbit = await getQbitHealth();

  return {
    irc: ircListener.getStatus(),
    ircDesired,
    wishlist: getWishlistStatus(),
    snatchCount: snatchCount(),
    lastAnnounce,
    mamConfigured: Boolean(getSetting('mam_id')),
    unsatisfied: getUnsatisfiedStatus(),
    timedLockout: getTimedLockoutStatus(),
    filtersAtLimit,
    qbit,
    downloadClient: getSetting('download_client') || 'qbittorrent',
  };
}

export type HealthChecks = {
  mamConfigured: boolean;
  ircDesired: boolean;
  ircJoined: boolean;
  unsatisfied: boolean;
  timedLockout: boolean;
  wishlistEnabled: boolean;
  qbitOk: boolean | null;
  qbitApplicable: boolean;
};

/** Operator-facing readiness: live snatching path healthy when desired. */
export async function buildHealthPayload() {
  const status = await buildStatusPayload();
  const qbit = status.qbit as QbitHealth;
  const checks: HealthChecks = {
    mamConfigured: status.mamConfigured,
    ircDesired: status.ircDesired,
    ircJoined: Boolean(status.irc?.joined),
    unsatisfied: Boolean(status.unsatisfied?.active),
    timedLockout: Boolean(status.timedLockout?.active),
    wishlistEnabled: status.wishlist?.enabled !== false,
    qbitOk: qbit.ok,
    qbitApplicable: qbit.applicable,
  };

  // Ready when MAM is configured, not lockout-paused, IRC joined if desired,
  // and qBit reachable when that is the download client.
  const qbitReady = !checks.qbitApplicable || checks.qbitOk === true;
  const ready =
    checks.mamConfigured &&
    !checks.unsatisfied &&
    !checks.timedLockout &&
    (!checks.ircDesired || checks.ircJoined) &&
    qbitReady;

  return {
    ok: true,
    ready,
    service: 'mybookbrr',
    version: 1,
    checks,
    qbit,
    filtersAtLimit: status.filtersAtLimit,
    time: new Date().toISOString(),
  };
}

export function buildPublicSettings() {
  return {
    downloadClient: getSetting('download_client') || 'qbittorrent',
    qbitHostConfigured: Boolean(getSetting('qbit_host')),
    mamConfigured: Boolean(getSetting('mam_id')),
    ircHost: getSetting('irc_host') || 'irc.myanonamouse.net',
    ircChannel: getSetting('irc_channel') || '#announce',
    ircNick: getSetting('irc_nick') || '',
    ircDesired: getSetting('irc_enabled') === 'true',
    wishlistPollEnabled: getSetting('wishlist_poll_enabled') !== 'false',
    filtersAutoDisableOnUnsatisfied: getSetting('filters_auto_disable_on_unsatisfied') !== 'false',
    discord: {
      stream: Boolean(getSetting('discord_webhook_stream')),
      errors: Boolean(getSetting('discord_webhook_errors')),
      snatch: Boolean(getSetting('discord_webhook_snatch')),
    },
  };
}
