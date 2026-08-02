import type { FastifyInstance } from 'fastify';
import { getAllSettings, getSetting, setSettings } from '../db/index.js';
import {
  deleteFilter,
  deleteWatch,
  getFilter,
  listEvents,
  listFilters,
  listSnatches,
  listWatches,
  saveFilter,
  saveWatch,
} from '../db/repos.js';
import {
  actorFromRequest,
  getSettingsVersion,
  listAudit,
  listSettingsVersions,
  recordSettingsVersion,
  restoreSettingsVersion,
  writeAudit,
} from '../db/audit.js';

import { searchTorrents, testMamSession } from '../mam/client.js';
import { mamHitToRelease } from '../wishlist/matcher.js';
import { getWishlistStatus, pollWishlistOnce, runWatchNow } from '../wishlist/poller.js';
import { eventBus, processRelease } from '../snatch/orchestrator.js';
import { ircListener } from '../irc/listener.js';
import { testQbittorrent } from '../clients/qbittorrent.js';
import { testDiscordWebhook, type DiscordWebhookChannel } from '../notify/discord.js';
import {
  clearUnsatisfiedLockout,
  getUnsatisfiedStatus,
} from '../filters/unsatisfiedGuard.js';
import {
  clearTimedLockout,
  getTimedLockoutStatus,
  setTimedLockout,
} from '../filters/timedLockout.js';
import { requireRole, requireUser } from '../auth/rbac.js';
import { runDatabaseBackup } from '../db/backup.js';
import { dryRunFilter } from '../filters/dryRun.js';
import { enrichFilterWithLimit } from '../filters/limitUsage.js';
import { buildStatusPayload } from './statusHelpers.js';
import type { FilterRule, WishlistWatch } from '../types.js';

export async function registerUiRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/status', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return buildStatusPayload();
  });

  app.get('/api/settings', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const all = getAllSettings();
    const mam = all.mam_id || '';
    const nickserv = all.irc_nickserv_password || '';
    return {
      ...all,
      mam_id: mam ? `********${mam.slice(-4)}` : '',
      mam_id_set: Boolean(mam),
      qbit_password: all.qbit_password ? '********' : '',
      irc_nickserv_password: nickserv ? '********' : '',
      irc_nickserv_password_set: Boolean(nickserv),
      discord_webhook_stream: '',
      discord_webhook_errors: '',
      discord_webhook_snatch: '',
      discord_webhook_url: '',
      discord_webhook_stream_set: Boolean((all.discord_webhook_stream || '').trim()),
      discord_webhook_errors_set: Boolean((all.discord_webhook_errors || '').trim()),
      discord_webhook_snatch_set: Boolean((all.discord_webhook_snatch || '').trim()),
    };
  });

  app.put('/api/settings', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as Record<string, string>;
    const allowed = [
      'mam_id', 'irc_nick', 'irc_nickserv_password', 'irc_host', 'irc_port', 'irc_channel',
      'qbit_host', 'qbit_username', 'qbit_password', 'qbit_category', 'qbit_save_path',
      'download_client', 'watch_folder',
      'discord_webhook_url', 'discord_webhook_stream', 'discord_webhook_errors', 'discord_webhook_snatch',
      'wishlist_poll_enabled', 'wishlist_default_interval',
      'filters_auto_disable_on_unsatisfied',
    ];
    const beforeAll = getAllSettings();
    const before = {
      irc_nick: beforeAll.irc_nick || '',
      irc_nickserv_password: beforeAll.irc_nickserv_password || '',
      irc_host: beforeAll.irc_host || '',
      irc_port: beforeAll.irc_port || '',
      irc_channel: beforeAll.irc_channel || '',
    };
    const updates: Record<string, string> = {};
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      if (key === 'mam_id' && body[key].startsWith('********')) continue;
      if (key === 'qbit_password' && body[key] === '********') continue;
      if (key === 'irc_nickserv_password' && body[key] === '********') continue;
      if (
        (key === 'discord_webhook_stream' ||
          key === 'discord_webhook_errors' ||
          key === 'discord_webhook_snatch' ||
          key === 'discord_webhook_url') &&
        !String(body[key]).trim()
      ) {
        continue;
      }
      updates[key] = String(body[key]).trim();
    }
    for (const key of [
      'discord_webhook_stream',
      'discord_webhook_errors',
      'discord_webhook_snatch',
      'discord_webhook_url',
    ] as const) {
      if (body[key] === '__clear__') updates[key] = '';
    }
    setSettings(updates);
    const afterAll = getAllSettings();

    const after = {
      irc_nick: afterAll.irc_nick || '',
      irc_nickserv_password: afterAll.irc_nickserv_password || '',
      irc_host: afterAll.irc_host || '',
      irc_port: afterAll.irc_port || '',
      irc_channel: afterAll.irc_channel || '',
    };
    const connChanged =
      before.irc_nick !== after.irc_nick ||
      before.irc_nickserv_password !== after.irc_nickserv_password ||
      before.irc_host !== after.irc_host ||
      before.irc_port !== after.irc_port ||
      before.irc_channel !== after.irc_channel;
    if (connChanged && ircListener.isActive()) {
      ircListener.restart('connection settings changed');
    }

    const actor = actorFromRequest(req);
    const ver = recordSettingsVersion({
      before: beforeAll,
      after: afterAll,
      updates,
      actor,
    });

    return {
      ok: true,
      settings_version: ver?.version ?? null,
      discord: {
        stream: Boolean(getSetting('discord_webhook_stream')),
        errors: Boolean(getSetting('discord_webhook_errors')),
        snatch: Boolean(getSetting('discord_webhook_snatch')),
      },
    };
  });

  app.post('/api/settings/test-mam', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    return testMamSession();
  });

  app.post('/api/settings/test-discord', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as { channel?: DiscordWebhookChannel; url?: string };
    const channel = body.channel;
    if (channel !== 'stream' && channel !== 'errors' && channel !== 'snatch') {
      return reply.code(400).send({ ok: false, message: 'channel must be stream | errors | snatch' });
    }
    const url = (body.url || '').trim();
    const override = url && !url.includes('…') && !url.includes('********') ? url : undefined;
    return testDiscordWebhook(channel, override);
  });

  app.post('/api/settings/test-qbit', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as { host?: string; username?: string; password?: string };
    const overrides: { host?: string; username?: string; password?: string } = {};
    if (body.host) overrides.host = body.host.replace(/\/$/, '');
    if (body.username) overrides.username = body.username;
    if (body.password) overrides.password = body.password;
    return testQbittorrent(overrides);
  });

  app.post('/api/backup', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    try {
      const dest = await runDatabaseBackup('manual-ui');
      const file = dest.split(/[/\\]/).pop();
      writeAudit({
        action: 'backup.create',
        summary: `Database backup ${file || 'created'}`,
        detail: { file, path: dest },
        actor: actorFromRequest(req),
      });
      return {
        ok: true,
        path: dest,
        file,
        at: new Date().toISOString(),
      };
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.get('/api/audit', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const q = req.query as { limit?: string; action?: string };
    const limit = q.limit ? Number(q.limit) : 100;
    return {
      entries: listAudit(Number.isFinite(limit) ? limit : 100, q.action || undefined),
    };
  });

  app.get('/api/settings/versions', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const q = req.query as { limit?: string };
    const limit = q.limit ? Number(q.limit) : 50;
    return {
      versions: listSettingsVersions(Number.isFinite(limit) ? limit : 50),
    };
  });

  app.get('/api/settings/versions/:version', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { version } = req.params as { version: string };
    const v = getSettingsVersion(Number(version));
    if (!v) return reply.code(404).send({ error: 'Version not found' });
    return v;
  });

  /** Restore non-secret settings from a historical snapshot (creates a new version). */
  app.post('/api/settings/versions/:version/restore', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { version } = req.params as { version: string };
    const n = Number(version);
    if (!Number.isFinite(n) || n < 1) {
      return reply.code(400).send({ ok: false, error: 'Invalid version' });
    }
    const result = restoreSettingsVersion(n, actorFromRequest(req));
    if (!result.ok) {
      return reply.code(404).send(result);
    }
    // Restart IRC if connection fields changed
    if (
      result.restoredKeys.some((k) =>
        ['irc_nick', 'irc_host', 'irc_port', 'irc_channel'].includes(k),
      ) &&
      ircListener.isActive()
    ) {
      ircListener.restart('settings restored from history');
    }
    return {
      ok: true,
      restored_from: n,
      new_version: result.version.version,
      restored_keys: result.restoredKeys,
      message:
        result.restoredKeys.length === 0
          ? `v${n} already matches current non-secret settings`
          : `Restored ${result.restoredKeys.length} field(s) from v${n} → new v${result.version.version}`,
    };
  });

  app.get('/api/filters', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return listFilters().map((f) => enrichFilterWithLimit(f));
  });

  app.post('/api/filters', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const saved = saveFilter(req.body as Partial<FilterRule>);
    writeAudit({
      action: 'filter.create',
      summary: `Created filter “${saved.name}”`,
      detail: {
        id: saved.id,
        name: saved.name,
        enabled: saved.enabled,
        maxDownloads: saved.maxDownloads,
        limitPeriod: saved.limitPeriod,
      },
      actor: actorFromRequest(req),
    });
    return saved;
  });

  app.put('/api/filters/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { id } = req.params as { id: string };
    const prev = getFilter(id);
    const saved = saveFilter({ ...(req.body as Partial<FilterRule>), id });
    const body = (req.body || {}) as Partial<FilterRule>;
    const action =
      prev && typeof body.enabled === 'boolean' && body.enabled !== prev.enabled
        ? body.enabled
          ? 'filter.enable'
          : 'filter.disable'
        : 'filter.update';
    writeAudit({
      action,
      summary:
        action === 'filter.enable'
          ? `Started filter “${saved.name}”`
          : action === 'filter.disable'
            ? `Stopped filter “${saved.name}”`
            : `Updated filter “${saved.name}”`,
      detail: {
        id: saved.id,
        name: saved.name,
        before: prev
          ? {
              enabled: prev.enabled,
              maxDownloads: prev.maxDownloads,
              limitPeriod: prev.limitPeriod,
              name: prev.name,
            }
          : null,
        after: {
          enabled: saved.enabled,
          maxDownloads: saved.maxDownloads,
          limitPeriod: saved.limitPeriod,
          name: saved.name,
        },
      },
      actor: actorFromRequest(req),
    });
    return saved;
  });

  app.delete('/api/filters/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { id } = req.params as { id: string };
    const prev = getFilter(id);
    deleteFilter(id);
    writeAudit({
      action: 'filter.delete',
      summary: `Deleted filter “${prev?.name || id}”`,
      detail: { id, name: prev?.name },
      actor: actorFromRequest(req),
    });
    return { ok: true };
  });

  app.post('/api/filters/:id/dry-run', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const { id } = req.params as { id: string };
    const filter = getFilter(id);
    if (!filter) return reply.code(404).send({ error: 'Filter not found' });
    const body = (req.body || {}) as { limit?: number; ignoreLimits?: boolean };
    return dryRunFilter(filter, {
      limit: body.limit,
      ignoreLimits: body.ignoreLimits !== false,
    });
  });

  app.get('/api/filters/unsatisfied', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return getUnsatisfiedStatus();
  });

  app.post('/api/filters/unsatisfied/clear', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as { reenableFilters?: boolean };
    const result = clearUnsatisfiedLockout(body.reenableFilters !== false);
    eventBus.broadcast('unsatisfied_limit_cleared', {
      at: new Date().toISOString(),
      ...result,
    });
    writeAudit({
      action: 'lockout.unsatisfied_clear',
      summary: 'Cleared unsatisfied lockout',
      detail: result,
      actor: actorFromRequest(req),
    });
    return { ok: true, ...result, unsatisfied: getUnsatisfiedStatus() };
  });

  app.get('/api/filters/timed-lockout', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return getTimedLockoutStatus();
  });

  app.post('/api/filters/timed-lockout', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as {
      until?: string;
      hours?: number;
      minutes?: number;
      note?: string;
      disableFilters?: boolean;
    };
    try {
      let until: Date | null = null;
      if (body.until) {
        until = new Date(body.until);
      } else if (body.hours != null || body.minutes != null) {
        const ms =
          (Number(body.hours) || 0) * 3_600_000 + (Number(body.minutes) || 0) * 60_000;
        if (ms <= 0) {
          return reply.code(400).send({ error: 'hours/minutes must be positive' });
        }
        until = new Date(Date.now() + ms);
      }
      if (!until || Number.isNaN(until.getTime())) {
        return reply.code(400).send({ error: 'Provide until (ISO) or hours/minutes' });
      }
      const status = await setTimedLockout({
        until,
        note: body.note,
        disableFilters: body.disableFilters,
      });
      return { ok: true, timedLockout: status };
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/api/filters/timed-lockout/clear', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as { reenableFilters?: boolean };
    const result = clearTimedLockout(body.reenableFilters !== false);
    writeAudit({
      action: 'lockout.timed_clear',
      summary: 'Cleared timed MAM lockout',
      detail: result,
      actor: actorFromRequest(req),
    });
    return { ok: true, ...result, timedLockout: getTimedLockoutStatus() };
  });

  app.post('/api/filters/test-discord', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = (req.body || {}) as { url?: string; filterId?: string; filterName?: string };
    let url = (body.url || '').trim();
    let filterName = (body.filterName || '').trim();
    if ((!url || url.includes('…') || url.includes('********')) && body.filterId) {
      const filter = getFilter(body.filterId);
      if (!filter) return reply.code(404).send({ ok: false, message: 'Filter not found' });
      url = (filter.discordWebhookUrl || '').trim();
      filterName = filterName || filter.name;
    }
    if (!url) {
      return {
        ok: false,
        message: 'No filter Discord webhook URL. Paste one on the filter (and Save) first.',
      };
    }
    return testDiscordWebhook('snatch', url, filterName || 'Filter test');
  });

  app.get('/api/wishlist', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return listWatches();
  });

  app.post('/api/wishlist', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    return saveWatch(req.body as Partial<WishlistWatch>);
  });

  app.put('/api/wishlist/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { id } = req.params as { id: string };
    return saveWatch({ ...(req.body as Partial<WishlistWatch>), id });
  });

  app.delete('/api/wishlist/:id', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { id } = req.params as { id: string };
    deleteWatch(id);
    return { ok: true };
  });

  app.post('/api/wishlist/:id/run', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const { id } = req.params as { id: string };
    return runWatchNow(id);
  });

  app.post('/api/wishlist/poll', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    await pollWishlistOnce();
    return getWishlistStatus();
  });

  app.get('/api/search', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    const q = req.query as { text?: string; mainCat?: string; perPage?: string };
    const mainCat = q.mainCat
      ? q.mainCat.split(',').map((n) => Number(n)).filter(Boolean)
      : undefined;
    const result = await searchTorrents({
      text: q.text || '',
      mainCat,
      perPage: Number(q.perPage || 25),
    });
    return {
      ...result,
      releases: result.data.map((h) => mamHitToRelease(h, 'manual')).filter(Boolean),
    };
  });

  app.post('/api/snatch', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    const body = req.body as {
      torrentId?: string;
      title?: string;
      author?: string;
      series?: string;
      narrator?: string;
      mediaType?: string;
      format?: string;
      sizeMB?: number;
      sizeStr?: string;
      freeleech?: boolean;
      vip?: boolean;
      bitrate?: number;
      torrentUrl?: string;
      year?: string;
      category?: string;
      force?: boolean;
    };
    if (!body.torrentId) return reply.code(400).send({ error: 'torrentId required' });
    const release = {
      torrentId: String(body.torrentId),
      title: body.title || `Torrent ${body.torrentId}`,
      author: body.author || 'Unknown Author',
      series: body.series || 'Standalone',
      narrator: body.narrator || 'N/A',
      mediaType: (body.mediaType === 'Audiobook' ? 'Audiobook' : 'eBook') as 'eBook' | 'Audiobook',
      format: body.format || (body.mediaType === 'Audiobook' ? 'M4B' : 'EPUB'),
      sizeMB: Number(body.sizeMB || 0),
      sizeStr: body.sizeStr || 'Unknown Size',
      freeleech: Boolean(body.freeleech),
      vip: Boolean(body.vip),
      bitrate: Number(body.bitrate || 0),
      torrentUrl: body.torrentUrl || `https://www.myanonamouse.net/t/${body.torrentId}`,
      source: 'manual' as const,
      raw: 'manual snatch',
      year: body.year,
      category: body.category,
    };
    return processRelease(release, {
      skipFilters: true,
      force: Boolean(body.force ?? true),
      quietStream: true,
    });
  });

  app.get('/api/snatches', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return listSnatches(200);
  });

  app.get('/api/events', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    return listEvents(100);
  });

  app.get('/api/events/stream', async (req, reply) => {
    if (!requireUser(req, reply)) return;
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', payload: { ok: true } })}\n\n`);
    const onEvent = (evt: { type: string; payload: unknown; createdAt?: string }) => {
      reply.raw.write(`data: ${JSON.stringify(evt)}\n\n`);
    };
    eventBus.on('event', onEvent);
    req.raw.on('close', () => {
      eventBus.off('event', onEvent);
    });
  });

  app.post('/api/irc/start', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    setSettings({ irc_status: 'starting' });
    ircListener.start();
    writeAudit({
      action: 'irc.start',
      summary: 'Started IRC listener',
      actor: actorFromRequest(req),
    });
    return ircListener.getStatus();
  });

  app.post('/api/irc/stop', async (req, reply) => {
    if (!requireRole(req, reply, 'admin')) return;
    ircListener.stop();
    setSettings({ irc_status: 'disconnected' });
    writeAudit({
      action: 'irc.stop',
      summary: 'Stopped IRC listener',
      actor: actorFromRequest(req),
    });
    return ircListener.getStatus();
  });
}
