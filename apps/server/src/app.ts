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
import type { PhoneAccess } from './phone.js';
import { hostPort, isRemote, requirePairing, type RemoteAccess } from './remote.js';
import { phoneRoutes } from './routes/phone.js';
import type { Services } from './services.js';

export interface AppOptions {
  /** The port the server listens on; the UI it serves itself comes from that origin. */
  port?: number;
  /** The built web UI to serve next to the API. */
  webDir?: string;
  /** Where paired devices reach the café right now, if anywhere (see remote.ts). */
  remote?: () => RemoteAccess | undefined;
  /** Lets the café page on this computer turn phone access on and off (see phone.ts). */
  phone?: PhoneAccess;
}

export async function buildApp(services?: Services, options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  // Phone access can come and go while the café runs, so origins are checked against it each time.
  const allowedOrigin = (origin: string) => allowedOrigins(options.port, options.remote?.()?.host).includes(origin);
  await app.register(cors, { origin: (origin, cb) => cb(null, origin !== undefined && allowedOrigin(origin)), methods: ['GET', 'POST', 'PATCH', 'DELETE'] });

  // A page on another site can point its own hostname at this computer (DNS rebinding) and then
  // read the API as if it were the café. Its Host header still names that site, so check it.
  if (options.port) {
    const port = options.port;
    const localHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    app.addHook('onRequest', async (req, reply) => {
      const remote = options.remote?.();
      const hosts = isRemote(req) ? (remote ? [hostPort(remote.host, port)] : []) : localHosts;
      if (!hosts.includes(req.headers.host ?? '')) {
        return reply.code(403).send({ error: 'Not allowed from this host.' });
      }
    });
  }
  if (options.remote) requirePairing(app, options.remote);

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
    if (origin && !allowedOrigin(origin)) return reply.code(403).send({ error: 'Not allowed from this origin.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  if (services) {
    await app.register(agentRoutes(services));
    await app.register(taskRoutes(services));
    await app.register(threadRoutes(services));
    await app.register(providerRoutes(services));
    await app.register(projectRoutes(services));
    await app.register(folderRoutes());
    await app.register(streamRoutes(services, allowedOrigin));
  }
  if (options.phone) await app.register(phoneRoutes(options.phone));

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
