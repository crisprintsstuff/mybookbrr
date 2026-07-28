import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { initDb, getSetting } from './db/index.js';
import { registerRoutes } from './api/routes.js';
import { bootstrapAdminIfNeeded } from './auth/bootstrap.js';
import { ircListener } from './irc/listener.js';
import { startWishlistPoller } from './wishlist/poller.js';
import { eventBus, processRelease } from './snatch/orchestrator.js';
import { alertIrcFailure } from './notify/alerts.js';
import { startBackupScheduler } from './db/backup.js';
import { startTimedLockoutScheduler } from './filters/timedLockout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7480);
const HOST = process.env.HOST || '0.0.0.0';

const DEFAULT_CORS_ORIGINS = [
  'https://mybookbrr.boznetwork.com',
  'http://127.0.0.1:7480',
  'http://localhost:7480',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
];

function resolveCorsOrigin(): boolean | string[] {
  const raw = (process.env.CORS_ORIGINS || '').trim();
  if (raw === '*') return true;
  return (raw ? raw.split(/[,\s]+/) : DEFAULT_CORS_ORIGINS)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  initDb();
  await bootstrapAdminIfNeeded();

  const trustProxy =
    process.env.TRUST_PROXY === 'true' || process.env.COOKIE_SECURE === 'true';
  const app = Fastify({ logger: true, trustProxy });
  const origin = resolveCorsOrigin();
  await app.register(cors, {
    origin,
    credentials: true,
  });
  await app.register(cookie);
  await registerRoutes(app);

  const clientDist = path.resolve(__dirname, '../client/dist');
  if (fs.existsSync(clientDist)) {
    await app.register(fastifyStatic, {
      root: clientDist,
      prefix: '/',
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  let lastIrcPhase = '';
  ircListener.on('announce', (release) => {
    void processRelease(release);
  });
  ircListener.on('status', (status) => {
    eventBus.broadcast('irc_status', status);
    const phase = String(status?.phase || '');
    if (phase && phase !== lastIrcPhase) {
      lastIrcPhase = phase;
      void alertIrcFailure(phase, status?.lastError || null);
    }
  });

  // Restore IRC if it was left running before the last stop/restart.
  if (getSetting('irc_enabled') === 'true') {
    console.log('[MyBookBRR] Restoring IRC listener (irc_enabled=true)');
    // Short delay so listen() binds first and we avoid connect races at boot.
    setTimeout(() => {
      try {
        ircListener.start();
      } catch (err) {
        console.error('[MyBookBRR] Failed to restore IRC:', err);
      }
    }, 1500);
  }

  startWishlistPoller();
  startBackupScheduler();
  startTimedLockoutScheduler();

  await app.listen({ port: PORT, host: HOST });
  console.log(`[MyBookBRR] listening on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
