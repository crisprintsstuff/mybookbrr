import type { FastifyInstance } from 'fastify';
import { authHook } from '../auth/middleware.js';
import { registerAuthRoutes } from './authRoutes.js';
import { registerUiRoutes } from './uiRoutes.js';
import { registerV1Routes } from './v1/routes.js';

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authHook);
  await registerAuthRoutes(app);
  await registerUiRoutes(app);
  await registerV1Routes(app);
}
