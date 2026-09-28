import { PROVIDER_IDS } from '@agent-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toTaskDTO, toTaskEventDTO } from '../db/mappers.js';
import { OrchestratorError, type EnqueueTarget } from '../orchestrator/orchestrator.js';
import type { Services } from '../services.js';

const createBody = z
  .object({
    prompt: z.string().trim().min(1).max(20_000),
    agentId: z.string().optional(),
    providerId: z.enum(PROVIDER_IDS).optional(),
    model: z.string().optional(),
    maxCostUsd: z.number().positive().max(100).optional(),
  })
  .refine((b) => b.agentId || b.providerId, { message: 'Pick an agent or a provider.' });

const approvalBody = z.object({ decision: z.enum(['allow', 'deny']) }).strict();

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  agentId: z.string().optional(),
  status: z.string().optional(),
});

export const taskRoutes =
  ({ db, orchestrator }: Services): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/tasks', async (req) => {
      const q = listQuery.parse(req.query);
      const rows = await db.task.findMany({
        where: { ...(q.agentId ? { agentId: q.agentId } : {}), ...(q.status ? { status: q.status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
      });
      return rows.map(toTaskDTO);
    });

    app.get<{ Params: { id: string } }>('/api/tasks/:id', async (req) => {
      const task = await db.task.findUnique({
        where: { id: req.params.id },
        include: { events: { orderBy: { seq: 'asc' } } },
      });
      if (!task) throw new OrchestratorError('Task not found.', 'not_found');
      return { task: toTaskDTO(task), events: task.events.map(toTaskEventDTO) };
    });

    app.post('/api/tasks', async (req, reply) => {
      const b = createBody.parse(req.body);
      const target: EnqueueTarget = b.agentId
        ? { agentId: b.agentId }
        : { providerId: b.providerId!, ...(b.model ? { model: b.model } : {}) };
      const task = await orchestrator.enqueue({
        prompt: b.prompt,
        target,
        ...(b.maxCostUsd ? { maxCostUsd: b.maxCostUsd } : {}),
      });
      return reply.code(201).send(task);
    });

    app.post<{ Params: { id: string } }>('/api/tasks/:id/cancel', (req) => orchestrator.cancel(req.params.id));
    app.post<{ Params: { id: string; approvalId: string } }>('/api/tasks/:id/approvals/:approvalId', (req) =>
      orchestrator.resolveApproval(req.params.id, req.params.approvalId, approvalBody.parse(req.body).decision),
    );
    app.post<{ Params: { id: string } }>('/api/tasks/:id/retry', async (req, reply) =>
      reply.code(201).send(await orchestrator.retry(req.params.id)),
    );
  };
