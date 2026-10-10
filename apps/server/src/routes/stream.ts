import type { CafeEvent } from '@agent-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { Services } from '../services.js';

const HEARTBEAT_MS = 15_000;

/**
 * Server-Sent Events: one `snapshot`, then every CafeEvent as it happens.
 * SSE over WebSockets because traffic is one-way (commands go over REST) and
 * EventSource gives reconnects for free.
 */
export const streamRoutes =
  ({ bus, orchestrator }: Services, allowedOrigin: (origin: string) => boolean): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/stream', async (req, reply) => {
      reply.hijack();
      const origin = req.headers.origin;
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
        ...(origin && allowedOrigin(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
      });

      const send = (e: CafeEvent) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`);

      // Subscribe before taking the snapshot and buffer, so nothing falls in the gap.
      let buffer: CafeEvent[] | null = [];
      const unsubscribe = bus.subscribe((e) => (buffer ? buffer.push(e) : send(e)));
      const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), HEARTBEAT_MS);
      req.raw.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      reply.raw.write('retry: 2000\n\n');
      send(await orchestrator.snapshot());
      for (const e of buffer) send(e);
      buffer = null;
    });
  };
