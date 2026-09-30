import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { toProjectDTO } from '../db/mappers.js';
import { OrchestratorError } from '../orchestrator/orchestrator.js';
import type { Services } from '../services.js';
import { expandPath } from './folders.js';

const run = promisify(execFile);

/**
 * An existing folder: absolute, or `~/…` from your home folder. Surrounding quotes
 * (from "Copy as path") are dropped.
 */
const folder = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .transform((p, ctx) => {
    const t = p.replace(/^"(.*)"$/, '$1');
    if (!t.startsWith('~') && !/^([a-zA-Z]:[\\/]|[\\/])/.test(t)) {
      ctx.addIssue({ code: 'custom', message: 'Use a full path, like C:\\Users\\you\\project or ~/project.' });
      return z.NEVER;
    }
    const dir = expandPath(t);
    try {
      if (statSync(dir).isDirectory()) return dir;
    } catch {
      /* fall through */
    }
    ctx.addIssue({ code: 'custom', message: "That folder doesn't exist." });
    return z.NEVER;
  });

/** A clone URL git can fetch without a local path: https, ssh, git@host:… (and file:// for tests). */
const cloneUrl = z
  .string()
  .trim()
  .max(500)
  .refine((u) => /^(https:\/\/|ssh:\/\/|git@[\w.-]+:|file:\/\/)\S+$/.test(u), 'Use an https:// or git@ URL.');

const cloneBody = z
  .object({
    url: cloneUrl,
    /** Folder the repository is cloned into (a new subfolder is created). */
    parent: folder,
    name: z.string().trim().regex(/^[\w.-]+$/, 'Use letters, numbers, dots, dashes or underscores.').max(100).optional(),
  })
  .strict();

/** "https://github.com/acme/web.git" → "web". */
export const repoName = (url: string) => (url.replace(/[/\\]+$/, '').split(/[/:]/).pop() ?? 'repo').replace(/\.git$/i, '') || 'repo';

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

    /** Clones a repository into a new folder under `parent`, then adds it as a project. */
    app.post('/api/projects/clone', async (req, reply) => {
      const b = cloneBody.parse(req.body);
      const name = b.name || repoName(b.url);
      const dest = join(b.parent, name);
      if (existsSync(dest)) throw new OrchestratorError(`${basename(dest)} already exists. Pick another folder or name.`, 'conflict');
      try {
        // "--" ends options, so a URL can never be read as one; no terminal prompts for credentials.
        await run('git', ['clone', '--', b.url, dest], {
          timeout: 15 * 60_000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
      } catch (err) {
        const e = err as { code?: string; stderr?: string; message: string };
        if (e.code === 'ENOENT') throw new OrchestratorError('Git isn’t installed. Install Git, then try again.', 'invalid');
        const why = (e.stderr ?? e.message).split(/\r?\n/).find((l) => /fatal|error/i.test(l)) ?? e.message;
        throw new OrchestratorError(`Couldn't clone: ${why.replace(/^fatal:\s*/i, '')}`, 'invalid');
      }
      const existing = await db.project.findUnique({ where: { path: dest } });
      const project = toProjectDTO(existing ?? (await db.project.create({ data: { path: dest, name } })));
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
