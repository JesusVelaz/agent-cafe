import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  });
  app.get('/api/health', async () => ({ ok: true }));
  return app;
}
