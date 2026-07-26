import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
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
  snatchCount,
} from '../db/repos.js';
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
import type { FilterRule, WishlistWatch } from '../types.js';

const sessions = new Map<string, number>();
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ah = createHash('sha256').update(a).digest();
  const bh = createHash('sha256').update(b).digest();
  return timingSafeEqual(ah, bh);
}

function getPassword(): string {
  return process.env.AUTH_PASSWORD || 'changeme';
}

function isAuthed(req: FastifyRequest): boolean {
  const token = (req.cookies as Record<string, string> | undefined)?.nbb_session
    || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '');
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function requireAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (isAuthed(req)) return true;
  reply.code(401).send({ error: 'Unauthorized' });
  return false;
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body || {}) as { password?: string };
    if (!body.password || !safeEqual(body.password, getPassword())) {
      return reply.code(401).send({ error: 'Invalid password' });
    }
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    reply.setCookie('nbb_session', token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS / 1000,
    });
    return { ok: true, token };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = (req.cookies as Record<string, string> | undefined)?.nbb_session;
    if (token) sessions.delete(token);
    reply.clearCookie('nbb_session', { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    return { authenticated: isAuthed(req) };
  });

  app.get('/api/status', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    let lastAnnounce: unknown = null;
    try {
      const raw = getSetting('last_announce');
      lastAnnounce = raw ? JSON.parse(raw) : null;
    } catch {
      lastAnnounce = null;
    }
    return {
      irc: ircListener.getStatus(),
      wishlist: getWishlistStatus(),
      snatchCount: snatchCount(),
      lastAnnounce,
      mamConfigured: Boolean(getSetting('mam_id')),
      unsatisfied: getUnsatisfiedStatus(),
    };
  });

  app.get('/api/settings', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const all = getAllSettings();
    // Never echo full mam_id — only whether set + last 4
    const mam = all.mam_id || '';
    const nickserv = all.irc_nickserv_password || '';
    return {
      ...all,
      mam_id: mam ? `********${mam.slice(-4)}` : '',
      mam_id_set: Boolean(mam),
      qbit_password: all.qbit_password ? '********' : '',
      irc_nickserv_password: nickserv ? '********' : '',
      irc_nickserv_password_set: Boolean(nickserv),
      // Webhook tokens: never echo full URL; UI uses *_set + paste-to-replace
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
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as Record<string, string>;
    const allowed = [
      'mam_id', 'irc_nick', 'irc_nickserv_password', 'irc_host', 'irc_port', 'irc_channel',
      'qbit_host', 'qbit_username', 'qbit_password', 'qbit_category', 'qbit_save_path',
      'download_client', 'watch_folder',
      'discord_webhook_url', 'discord_webhook_stream', 'discord_webhook_errors', 'discord_webhook_snatch',
      'wishlist_poll_enabled', 'wishlist_default_interval',
      'filters_auto_disable_on_unsatisfied',
    ];
    const before = {
      irc_nick: getSetting('irc_nick') || '',
      irc_nickserv_password: getSetting('irc_nickserv_password') || '',
      irc_host: getSetting('irc_host') || '',
      irc_port: getSetting('irc_port') || '',
      irc_channel: getSetting('irc_channel') || '',
    };
    const updates: Record<string, string> = {};
    for (const key of allowed) {
      if (body[key] === undefined) continue;
      if (key === 'mam_id' && body[key].startsWith('********')) continue;
      if (key === 'qbit_password' && body[key] === '********') continue;
      if (key === 'irc_nickserv_password' && body[key] === '********') continue;
      // Empty webhook fields mean "leave unchanged" (paste-to-replace UX)
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
    // Explicit clear: client can send "__clear__"
    for (const key of [
      'discord_webhook_stream',
      'discord_webhook_errors',
      'discord_webhook_snatch',
      'discord_webhook_url',
    ] as const) {
      if (body[key] === '__clear__') updates[key] = '';
    }
    setSettings(updates);

    const after = {
      irc_nick: getSetting('irc_nick') || '',
      irc_nickserv_password: getSetting('irc_nickserv_password') || '',
      irc_host: getSetting('irc_host') || '',
      irc_port: getSetting('irc_port') || '',
      irc_channel: getSetting('irc_channel') || '',
    };

    const connChanged =
      before.irc_nick !== after.irc_nick ||
      before.irc_nickserv_password !== after.irc_nickserv_password ||
      before.irc_host !== after.irc_host ||
      before.irc_port !== after.irc_port ||
      before.irc_channel !== after.irc_channel;

    // Never auto-start from Settings. Only restart if IRC is already running and conn settings changed.
    if (connChanged && ircListener.isActive()) {
      ircListener.restart('connection settings changed');
    }

    return {
      ok: true,
      discord: {
        stream: Boolean(getSetting('discord_webhook_stream')),
        errors: Boolean(getSetting('discord_webhook_errors')),
        snatch: Boolean(getSetting('discord_webhook_snatch')),
      },
    };
  });

  app.post('/api/settings/test-mam', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return testMamSession();
  });

  app.post('/api/settings/test-discord', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as { channel?: DiscordWebhookChannel; url?: string };
    const channel = body.channel;
    if (channel !== 'stream' && channel !== 'errors' && channel !== 'snatch') {
      return reply.code(400).send({ ok: false, message: 'channel must be stream | errors | snatch' });
    }
    const url = (body.url || '').trim();
    // Ignore masked placeholders from the settings GET
    const override = url && !url.includes('…') && !url.includes('********') ? url : undefined;
    return testDiscordWebhook(channel, override);
  });

  app.post('/api/settings/test-qbit', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as {
      host?: string;
      username?: string;
      password?: string;
    };
    const overrides: { host?: string; username?: string; password?: string } = {};
    if (body.host) overrides.host = body.host.replace(/\/$/, '');
    if (body.username) overrides.username = body.username;
    if (body.password) overrides.password = body.password;
    return testQbittorrent(overrides);
  });

  app.get('/api/filters', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return listFilters();
  });

  app.post('/api/filters', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = req.body as Partial<FilterRule>;
    return saveFilter(body);
  });

  app.put('/api/filters/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = req.body as Partial<FilterRule>;
    return saveFilter({ ...body, id });
  });

  app.delete('/api/filters/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    deleteFilter(id);
    return { ok: true };
  });

  app.get('/api/filters/unsatisfied', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return getUnsatisfiedStatus();
  });

  app.post('/api/filters/unsatisfied/clear', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = (req.body || {}) as { reenableFilters?: boolean };
    const result = clearUnsatisfiedLockout(body.reenableFilters !== false);
    eventBus.broadcast('unsatisfied_limit_cleared', {
      at: new Date().toISOString(),
      ...result,
    });
    return { ok: true, ...result, unsatisfied: getUnsatisfiedStatus() };
  });

  app.post('/api/filters/test-discord', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
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
    if (!requireAuth(req, reply)) return;
    return listWatches();
  });

  app.post('/api/wishlist', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const body = req.body as Partial<WishlistWatch>;
    return saveWatch(body);
  });

  app.put('/api/wishlist/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    const body = req.body as Partial<WishlistWatch>;
    return saveWatch({ ...body, id });
  });

  app.delete('/api/wishlist/:id', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    deleteWatch(id);
    return { ok: true };
  });

  app.post('/api/wishlist/:id/run', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    const { id } = req.params as { id: string };
    return runWatchNow(id);
  });

  app.post('/api/wishlist/poll', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    await pollWishlistOnce();
    return getWishlistStatus();
  });

  app.get('/api/search', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
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
    if (!requireAuth(req, reply)) return;
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
    if (!requireAuth(req, reply)) return;
    return listSnatches(200);
  });

  app.get('/api/events', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    return listEvents(100);
  });

  app.get('/api/events/stream', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
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
    if (!requireAuth(req, reply)) return;
    setSettings({ irc_status: 'starting' });
    ircListener.start(); // no-op if already connected; does not persist autostart
    return ircListener.getStatus();
  });

  app.post('/api/irc/stop', async (req, reply) => {
    if (!requireAuth(req, reply)) return;
    ircListener.stop();
    setSettings({ irc_status: 'disconnected' });
    return ircListener.getStatus();
  });
}
