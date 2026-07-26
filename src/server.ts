import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { initDb } from './db/index.js';
import { registerRoutes } from './api/routes.js';
import { ircListener } from './irc/listener.js';
import { startWishlistPoller } from './wishlist/poller.js';
import { eventBus, processRelease } from './snatch/orchestrator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 7480);
const HOST = process.env.HOST || '0.0.0.0';

async function main() {
  initDb();

  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true, credentials: true });
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

  ircListener.on('announce', (release) => {
    void processRelease(release);
  });
  ircListener.on('status', (status) => {
    eventBus.broadcast('irc_status', status);
  });

  // IRC is manual-only — start from Dashboard when needed (avoids surprise reconnects/floods).
  startWishlistPoller();

  await app.listen({ port: PORT, host: HOST });
  console.log(`[Newbookbot] listening on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
