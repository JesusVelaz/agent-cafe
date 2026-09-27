import { randomInt } from 'node:crypto';
import { PROVIDER_IDS } from '@agent-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toAgentDTO } from '../db/mappers.js';
import { OrchestratorError } from '../orchestrator/orchestrator.js';
import type { Services } from '../services.js';

const DEFAULT_PROMPT = 'You are a helpful agent working in Agent Café. Use tools when they help. Be concise.';

const createBody = z.object({
  name: z.string().trim().min(1).max(24),
  providerId: z.enum(PROVIDER_IDS),
  model: z.string().trim().min(1).max(100),
  systemPrompt: z.string().max(8000).optional(),
});

const patchBody = z.object({
  name: z.string().trim().min(1).max(24).optional(),
  model: z.string().trim().min(1).max(100).optional(),
  systemPrompt: z.string().max(8000).optional(),
  archived: z.boolean().optional(),
});

export const agentRoutes =
  ({ db, bus }: Services): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/agents', async () => {
      const agents = await db.agent.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
      return agents.map(toAgentDTO);
    });

    app.post('/api/agents', async (req, reply) => {
      const body = createBody.parse(req.body);
      const agent = toAgentDTO(
        await db.agent.create({
          data: { ...body, systemPrompt: body.systemPrompt?.trim() || DEFAULT_PROMPT, spriteSeed: randomInt(1, 1_000_000) },
        }),
      );
      bus.publish({ type: 'agent.upserted', agent });
      return reply.code(201).send(agent);
    });

    app.patch<{ Params: { id: string } }>('/api/agents/:id', async (req) => {
      const { archived, ...rest } = patchBody.parse(req.body);
      const existing = await db.agent.findUnique({ where: { id: req.params.id } });
      if (!existing) throw new OrchestratorError('Agent not found.', 'not_found');
      // Model changes apply to tasks queued from now on; queued tasks keep their model.
      const agent = toAgentDTO(
        await db.agent.update({
          where: { id: req.params.id },
          data: { ...rest, ...(archived !== undefined ? { archivedAt: archived ? new Date() : null } : {}) },
        }),
      );
      bus.publish({ type: 'agent.upserted', agent });
      return agent;
    });
  };
