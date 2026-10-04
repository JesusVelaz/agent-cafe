import { CATALOG_AS_OF, MODEL_CATALOG, PROVIDER_IDS, modelsFor, type HarnessCommandDTO, type HarnessModelDTO } from '@agent-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ConfigError } from '../providers/config.js';
import type { Services } from '../services.js';

const idParam = z.object({ id: z.enum(PROVIDER_IDS) });

const TIER_NOTE = { flagship: 'Most capable', balanced: 'Balanced', fast: 'Fastest' } as const;

const providerPatch = z.object({ mode: z.enum(['live', 'mock', 'off']).optional() }).strict();

const settingsPatch = z.object({ ambient: z.boolean().optional() }).strict();

/** Floors (mode + harness status), settings and models. There are no credentials here. */
export const providerRoutes =
  ({ db, providers, settings, bus }: Services): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/catalog', async () => ({ asOf: CATALOG_AS_OF, models: MODEL_CATALOG }));

    app.get('/api/providers', () => providers.all());

    app.patch('/api/providers/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      const provider = await providers.update(id, providerPatch.parse(req.body));
      bus.publish({ type: 'provider.updated', provider });
      return provider;
    });

    /** Re-checks the harness (installed? signed in?). */
    app.post('/api/providers/:id/check', async (req) => {
      const { id } = idParam.parse(req.params);
      await providers.harnesses.check(id);
      const provider = await providers.status(id);
      bus.publish({ type: 'provider.updated', provider });
      return provider;
    });

    /** Opens the vendor's own sign-in in a terminal window; the sign-in watch pushes the result. */
    app.post('/api/providers/:id/connect', async (req) => {
      const { id } = idParam.parse(req.params);
      try {
        await providers.harnesses.connect(id);
      } catch (err) {
        throw new ConfigError((err as Error).message);
      }
      // Pushed even when nothing changed, so a café showing a stale "Not connected" catches up.
      const provider = await providers.status(id);
      bus.publish({ type: 'provider.updated', provider });
      return { ok: true, connected: provider.connection.state === 'ready' };
    });

    app.post('/api/providers/:id/disconnect', async (req) => {
      const { id } = idParam.parse(req.params);
      await providers.harnesses.disconnect(id);
      const provider = await providers.status(id);
      bus.publish({ type: 'provider.updated', provider });
      return provider;
    });

    /** Demo catalog and account-discovered live models never share a fallback. */
    app.get('/api/providers/:id/models', async (req): Promise<{ source: 'harness' | 'catalog' | 'unavailable'; models: HarnessModelDTO[]; message?: string }> => {
      const { id } = idParam.parse(req.params);
      const mode = await providers.mode(id);
      if (mode === 'mock') return { source: 'catalog', models: modelsFor(id).map((m) => ({ value: m.id, label: m.label.replace(/^Claude /, ''), description: TIER_NOTE[m.tier] })) };
      if (mode === 'off') return { source: 'unavailable', models: [], message: 'This floor is switched off.' };
      const { refresh } = z.object({ refresh: z.enum(['true', 'false']).optional() }).parse(req.query);
      try {
        const connection = refresh === 'true' ? await providers.harnesses.check(id) : await providers.harnesses.ensure(id);
        if (connection.state !== 'ready') return { source: 'unavailable', models: [], message: connection.message ?? `Connect ${id === 'openai' ? 'ChatGPT' : 'Claude'} to choose a live model.` };
        const models = await providers.harnesses.models(id);
        if (!models.length) return { source: 'unavailable', models: [], message: 'No available models were reported. Refresh to try again.' };
        return { source: 'harness', models: models.map((m) => m.value === 'default' ? { ...m, tag: 'Default' } : m) };
      } catch {
        return { source: 'unavailable', models: [], message: 'Could not load available models. Refresh to try again.' };
      }
    });

    /** Commands are discovered in the selected project because both harnesses support project-local skills. */
    app.get('/api/providers/:id/commands', async (req): Promise<{ source: 'harness' | 'unavailable'; commands: HarnessCommandDTO[]; message?: string }> => {
      const { id } = idParam.parse(req.params);
      const { projectId, refresh } = z.object({ projectId: z.string().optional(), refresh: z.enum(['true', 'false']).optional() }).parse(req.query);
      if (await providers.mode(id) !== 'live') return { source: 'unavailable', commands: [], message: 'Slash commands are available in Live mode.' };
      if (!projectId) return { source: 'unavailable', commands: [], message: 'Pick a project to load its slash commands.' };
      const project = await db.project.findUnique({ where: { id: projectId } });
      if (!project) return { source: 'unavailable', commands: [], message: 'That project no longer exists.' };
      try {
        const connection = refresh === 'true' ? await providers.harnesses.check(id) : await providers.harnesses.ensure(id);
        if (connection.state !== 'ready') return { source: 'unavailable', commands: [], message: connection.message ?? `Connect ${id === 'openai' ? 'ChatGPT' : 'Claude'} to load commands.` };
        const commands = await providers.harnesses.commands(id, project.path);
        return commands.length
          ? { source: 'harness', commands }
          : { source: 'unavailable', commands: [], message: `No commands were reported by ${id === 'openai' ? 'Codex' : 'Claude Code'}.` };
      } catch {
        return { source: 'unavailable', commands: [], message: 'Could not load slash commands. Try again.' };
      }
    });

    app.get('/api/settings', () => settings.get());

    app.patch('/api/settings', async (req) => {
      const next = await settings.update(settingsPatch.parse(req.body));
      bus.publish({ type: 'settings.updated', settings: next });
      return next;
    });
  };
