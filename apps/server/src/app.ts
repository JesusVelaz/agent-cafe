import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { allowedOrigins } from './config.js';
import { ZodError } from 'zod';
import { OrchestratorError } from './orchestrator/orchestrator.js';
import { ConfigError } from './providers/config.js';
import { agentRoutes } from './routes/agents.js';
import { folderRoutes } from './routes/folders.js';
import { projectRoutes } from './routes/projects.js';
import { providerRoutes } from './routes/providers.js';
import { streamRoutes } from './routes/stream.js';
import { taskRoutes } from './routes/tasks.js';
import { threadRoutes } from './routes/threads.js';
import type { Services } from './services.js';

export interface AppOptions {
  /** The port the server listens on; the UI it serves itself comes from that origin. */
  port?: number;
  /** The built web UI to serve next to the API. */
  webDir?: string;
}

export async function buildApp(services?: Services, options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const origins = allowedOrigins(options.port);
  await app.register(cors, { origin: origins, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    }
    if (err instanceof ConfigError) return reply.code(400).send({ error: err.message });
    if (err instanceof OrchestratorError) {
      const code = { not_found: 404, conflict: 409, invalid: 400 }[err.code];
      return reply.code(code).send({ error: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    console.error(err);
    return reply.code(500).send({ error: 'Internal error' });
  });

  // Only the café UI (or a local tool that sends no Origin) may change anything. Bodyless POSTs
  // are "simple" requests that skip CORS preflight, so check the Origin explicitly.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) return reply.code(403).send({ error: 'Not allowed from this origin.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  if (services) {
    await app.register(agentRoutes(services));
    await app.register(taskRoutes(services));
    await app.register(threadRoutes(services));
    await app.register(providerRoutes(services));
    await app.register(projectRoutes(services));
    await app.register(folderRoutes());
    await app.register(streamRoutes(services, origins));
  }

  if (options.webDir) {
    if (!existsSync(join(options.webDir, 'index.html'))) throw new Error(`No built web UI in ${options.webDir}. Run \`pnpm build\` first.`);
    await app.register(fastifyStatic, { root: options.webDir });
    // The UI is a single page: any other path that isn't the API gets it too.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not found' });
    });
  }
  return app;
}
