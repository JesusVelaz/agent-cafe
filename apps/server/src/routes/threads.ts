import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services.js';

const settingsBody = z
  .object({
    title: z.string().max(200).nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

/** A thread is addressed by any of its tasks; the server finds its first task. */
export const threadRoutes =
  ({ orchestrator }: Services): FastifyPluginAsync =>
  async (app) => {
    app.patch<{ Params: { id: string } }>('/api/threads/:id', (req) =>
      orchestrator.updateThread(req.params.id, settingsBody.parse(req.body)),
    );
    app.delete<{ Params: { id: string } }>('/api/threads/:id', (req) => orchestrator.deleteThread(req.params.id));
  };
