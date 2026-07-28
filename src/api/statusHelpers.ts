import { getSetting } from '../db/index.js';
import { snatchCount } from '../db/repos.js';
import { getUnsatisfiedStatus } from '../filters/unsatisfiedGuard.js';
import { ircListener } from '../irc/listener.js';
import { getWishlistStatus } from '../wishlist/poller.js';

export function buildStatusPayload() {
  let lastAnnounce: unknown = null;
  try {
    const raw = getSetting('last_announce');
    lastAnnounce = raw ? JSON.parse(raw) : null;
  } catch {
    lastAnnounce = null;
  }
  const ircDesired = getSetting('irc_enabled') === 'true';
  return {
    irc: ircListener.getStatus(),
    ircDesired,
    wishlist: getWishlistStatus(),
    snatchCount: snatchCount(),
    lastAnnounce,
    mamConfigured: Boolean(getSetting('mam_id')),
    unsatisfied: getUnsatisfiedStatus(),
  };
}

export type HealthChecks = {
  mamConfigured: boolean;
  ircDesired: boolean;
  ircJoined: boolean;
  unsatisfied: boolean;
  wishlistEnabled: boolean;
};

/** Operator-facing readiness: live snatching path healthy when desired. */
export function buildHealthPayload() {
  const status = buildStatusPayload();
  const checks: HealthChecks = {
    mamConfigured: status.mamConfigured,
    ircDesired: status.ircDesired,
    ircJoined: Boolean(status.irc?.joined),
    unsatisfied: Boolean(status.unsatisfied?.active),
    wishlistEnabled: status.wishlist?.enabled !== false,
  };

  // Ready when MAM is configured, not lockout-paused, and IRC is joined if it should be running.
  const ready =
    checks.mamConfigured && !checks.unsatisfied && (!checks.ircDesired || checks.ircJoined);

  return {
    ok: true,
    ready,
    service: 'mybookbrr',
    version: 1,
    checks,
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
