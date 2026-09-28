import { statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toProjectDTO } from '../db/mappers.js';
import { OrchestratorError } from '../orchestrator/orchestrator.js';
import type { Services } from '../services.js';

/** An existing folder, as an absolute path. Surrounding quotes (from "Copy as path") are dropped. */
const folder = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .transform((p, ctx) => {
    const dir = p.replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(dir)) {
      ctx.addIssue({ code: 'custom', message: 'Use a full path, like C:\\Users\\you\\project.' });
      return z.NEVER;
    }
    try {
      if (statSync(dir).isDirectory()) return resolve(dir);
    } catch {
      /* fall through */
    }
    ctx.addIssue({ code: 'custom', message: "That folder doesn't exist." });
    return z.NEVER;
  });

const createBody = z.object({ path: folder, name: z.string().trim().max(40).optional() }).strict();
const patchBody = z.object({ name: z.string().trim().min(1).max(40) }).strict();

/** Projects: folders agents work in, added once and then picked by name. */
export const projectRoutes =
  ({ db, bus }: Services): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/projects', async () => (await db.project.findMany({ orderBy: { createdAt: 'asc' } })).map(toProjectDTO));

    app.post('/api/projects', async (req, reply) => {
      const b = createBody.parse(req.body);
      const existing = await db.project.findUnique({ where: { path: b.path } });
      if (existing) return reply.code(200).send(toProjectDTO(existing));
      const project = toProjectDTO(await db.project.create({ data: { path: b.path, name: b.name || basename(b.path) || b.path } }));
      bus.publish({ type: 'project.upserted', project });
      return reply.code(201).send(project);
    });

    app.patch<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
      const b = patchBody.parse(req.body);
      if (!(await db.project.findUnique({ where: { id: req.params.id } }))) throw new OrchestratorError('Project not found.', 'not_found');
      const project = toProjectDTO(await db.project.update({ where: { id: req.params.id }, data: { name: b.name } }));
      bus.publish({ type: 'project.upserted', project });
      return project;
    });

    /** Removes it from the list; the folder itself is untouched. */
    app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
      const { count } = await db.project.deleteMany({ where: { id: req.params.id } });
      if (!count) throw new OrchestratorError('Project not found.', 'not_found');
      await db.agent.updateMany({ where: { projectId: req.params.id }, data: { projectId: null } });
      bus.publish({ type: 'project.removed', projectId: req.params.id });
      return reply.code(204).send();
    });
  };
