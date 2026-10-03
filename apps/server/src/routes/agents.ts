import { randomInt } from 'node:crypto';
import { HARNESS, PROVIDER_IDS, offeredModel, type ProviderId } from '@agent-cafe/shared';
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
  projectId: z.string().nullable().optional(),
  /** The character's look (hair, skin, clothes are derived from it). */
  spriteSeed: z.number().int().min(1).max(999_999).optional(),
  permission: z.enum(['ask', 'acceptEdits']).optional(),
  archived: z.boolean().optional(),
});

export const agentRoutes =
  ({ db, bus, providers }: Services): FastifyPluginAsync =>
  async (app) => {
    const validateModel = async (id: ProviderId, model: string) => {
      if (await providers.mode(id) !== 'live') return;
      const models = await providers.harnesses.models(id).catch(() => []);
      if (!models.length) throw new OrchestratorError('Could not verify available models. Refresh the model list and try again.', 'conflict');
      if (!offeredModel(models, model)) throw new OrchestratorError(`${model} is not available in ${HARNESS[id].name} for this account.`, 'invalid');
    };
    app.get('/api/agents', async () => {
      const agents = await db.agent.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } });
      return agents.map(toAgentDTO);
    });

    app.post('/api/agents', async (req, reply) => {
      const body = createBody.parse(req.body);
      await validateModel(body.providerId, body.model);
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
      if (rest.model) await validateModel(existing.providerId as ProviderId, rest.model);
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
