import type { FastifyInstance } from 'fastify';
import { setSettings } from '../../db/index.js';
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
} from '../../db/repos.js';
import { dryRunFilter } from '../../filters/dryRun.js';
import { getWishlistStatus, pollWishlistOnce, runWatchNow } from '../../wishlist/poller.js';
import { eventBus, processRelease } from '../../snatch/orchestrator.js';
import { ircListener } from '../../irc/listener.js';
import { identityHasScope, requireScope } from '../../auth/rbac.js';
import { enrichFilterWithLimit } from '../../filters/limitUsage.js';
import { buildPublicSettings, buildStatusPayload, buildHealthPayload } from '../statusHelpers.js';
import {
  clearUnsatisfiedLockout,
  getUnsatisfiedStatus,
} from '../../filters/unsatisfiedGuard.js';
import {
  clearTimedLockout,
  getTimedLockoutStatus,
  setTimedLockout,
} from '../../filters/timedLockout.js';
import { runDatabaseBackup } from '../../db/backup.js';
import type { FilterRule, WishlistWatch } from '../../types.js';

export async function registerV1Routes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/health', async () => buildHealthPayload());

  app.get('/api/v1/status', async (req, reply) => {
    if (!requireScope(req, reply, 'status:read')) return;
    return buildStatusPayload();
  });

  app.get('/api/v1/settings/public', async (req, reply) => {
    if (!requireScope(req, reply, 'status:read')) return;
    return buildPublicSettings();
  });

  app.get('/api/v1/filters', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:read')) return;
    return listFilters().map((f) => enrichFilterWithLimit(f));
  });

  app.post('/api/v1/filters', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:write')) return;
    return saveFilter(req.body as Partial<FilterRule>);
  });

  app.put('/api/v1/filters/:id', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:write')) return;
    const { id } = req.params as { id: string };
    return saveFilter({ ...(req.body as Partial<FilterRule>), id });
  });

  app.delete('/api/v1/filters/:id', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:write')) return;
    const { id } = req.params as { id: string };
    deleteFilter(id);
    return { ok: true };
  });

  /** Re-score recent announces against one filter (no snatches). */
  app.post('/api/v1/filters/:id/dry-run', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:read')) return;
    const { id } = req.params as { id: string };
    const filter = getFilter(id);
    if (!filter) return reply.code(404).send({ error: 'Filter not found' });
    const body = (req.body || {}) as { limit?: number; ignoreLimits?: boolean };
    return dryRunFilter(filter, {
      limit: body.limit,
      ignoreLimits: body.ignoreLimits !== false,
    });
  });

  app.get('/api/v1/filters/unsatisfied', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:read')) return;
    return getUnsatisfiedStatus();
  });

  app.post('/api/v1/filters/unsatisfied/clear', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:write')) return;
    const body = (req.body || {}) as { reenableFilters?: boolean };
    const result = clearUnsatisfiedLockout(body.reenableFilters !== false);
    eventBus.broadcast('unsatisfied_limit_cleared', {
      at: new Date().toISOString(),
      ...result,
    });
    return { ok: true, ...result, unsatisfied: getUnsatisfiedStatus() };
  });

  app.get('/api/v1/filters/timed-lockout', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:read')) return;
    return getTimedLockoutStatus();
  });

  app.post('/api/v1/filters/timed-lockout', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:write')) return;
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

  app.post('/api/v1/filters/timed-lockout/clear', async (req, reply) => {
    if (!requireScope(req, reply, 'filters:write')) return;
    const body = (req.body || {}) as { reenableFilters?: boolean };
    const result = clearTimedLockout(body.reenableFilters !== false);
    return { ok: true, ...result, timedLockout: getTimedLockoutStatus() };
  });

  app.get('/api/v1/wishlist', async (req, reply) => {
    if (!requireScope(req, reply, 'wishlist:read')) return;
    return listWatches();
  });

  app.post('/api/v1/wishlist', async (req, reply) => {
    if (!requireScope(req, reply, 'wishlist:write')) return;
    return saveWatch(req.body as Partial<WishlistWatch>);
  });

  app.put('/api/v1/wishlist/:id', async (req, reply) => {
    if (!requireScope(req, reply, 'wishlist:write')) return;
    const { id } = req.params as { id: string };
    return saveWatch({ ...(req.body as Partial<WishlistWatch>), id });
  });

  app.delete('/api/v1/wishlist/:id', async (req, reply) => {
    if (!requireScope(req, reply, 'wishlist:write')) return;
    const { id } = req.params as { id: string };
    deleteWatch(id);
    return { ok: true };
  });

  app.post('/api/v1/wishlist/:id/run', async (req, reply) => {
    if (!requireScope(req, reply, 'wishlist:write')) return;
    const { id } = req.params as { id: string };
    return runWatchNow(id);
  });

  app.post('/api/v1/wishlist/poll', async (req, reply) => {
    if (!requireScope(req, reply, 'wishlist:write')) return;
    await pollWishlistOnce();
    return getWishlistStatus();
  });

  app.get('/api/v1/snatches', async (req, reply) => {
    if (!requireScope(req, reply, 'history:read')) return;
    const q = req.query as { limit?: string };
    return listSnatches(Math.min(500, Number(q.limit || 200)));
  });

  app.get('/api/v1/events', async (req, reply) => {
    if (!requireScope(req, reply, 'events:read')) return;
    const q = req.query as { limit?: string };
    return listEvents(Math.min(500, Number(q.limit || 100)));
  });

  app.get('/api/v1/events/stream', async (req, reply) => {
    if (!requireScope(req, reply, 'events:read')) return;
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

  app.post('/api/v1/irc/start', async (req, reply) => {
    if (!requireScope(req, reply, 'irc:control')) return;
    setSettings({ irc_status: 'starting' });
    ircListener.start();
    return ircListener.getStatus();
  });

  app.post('/api/v1/irc/stop', async (req, reply) => {
    if (!requireScope(req, reply, 'irc:control')) return;
    ircListener.stop();
    setSettings({ irc_status: 'disconnected' });
    return ircListener.getStatus();
  });

  /** Manual SQLite backup (same as nightly scheduler). */
  app.post('/api/v1/backup', async (req, reply) => {
    // Hub keys usually have filters:write; accept that or snatch:write.
    if (!identityHasScope(req, 'filters:write') && !identityHasScope(req, 'snatch:write')) {
      if (!requireScope(req, reply, 'filters:write')) return;
    }
    try {
      const dest = await runDatabaseBackup('manual-api');
      return {
        ok: true,
        path: dest,
        file: dest.split(/[/\\]/).pop(),
        at: new Date().toISOString(),
      };
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  app.post('/api/v1/snatch', async (req, reply) => {
    if (!requireScope(req, reply, 'snatch:write')) return;
    const body = (req.body || {}) as {
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
    return processRelease(
      {
        torrentId: String(body.torrentId),
        title: body.title || `Torrent ${body.torrentId}`,
        author: body.author || 'Unknown Author',
        series: body.series || 'Standalone',
        narrator: body.narrator || 'N/A',
        mediaType: body.mediaType === 'Audiobook' ? 'Audiobook' : 'eBook',
        format: body.format || (body.mediaType === 'Audiobook' ? 'M4B' : 'EPUB'),
        sizeMB: Number(body.sizeMB || 0),
        sizeStr: body.sizeStr || 'Unknown Size',
        freeleech: Boolean(body.freeleech),
        vip: Boolean(body.vip),
        bitrate: Number(body.bitrate || 0),
        torrentUrl: body.torrentUrl || `https://www.myanonamouse.net/t/${body.torrentId}`,
        source: 'manual',
        raw: 'api v1 snatch',
        year: body.year,
        category: body.category,
      },
      { skipFilters: true, force: Boolean(body.force ?? true), quietStream: true }
    );
  });
}
