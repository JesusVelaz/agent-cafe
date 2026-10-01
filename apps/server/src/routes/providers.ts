import { CATALOG_AS_OF, MODEL_CATALOG, PROVIDER_IDS, modelsFor, type HarnessModelDTO } from '@agent-cafe/shared';
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
  ({ providers, settings, bus }: Services): FastifyPluginAsync =>
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

    /**
     * Every model for the floor, newest first, as full ids (the harness accepts them).
     * When the harness is signed in, its default is tagged so the picker can say so.
     */
    app.get('/api/providers/:id/models', async (req): Promise<{ source: 'harness' | 'catalog'; models: HarnessModelDTO[] }> => {
      const { id } = idParam.parse(req.params);
      const models: HarnessModelDTO[] = modelsFor(id).map((m) => ({
        value: m.id,
        label: m.label.replace(/^Claude /, ''),
        description: TIER_NOTE[m.tier],
      }));
      const live = await providers.harnesses.models(id).catch(() => []);
      if (!live.length) return { source: 'catalog', models };
      // Codex lists the exact models this account can use (with its default tagged); offer those.
      if (id === 'openai') return { source: 'harness', models: live };
      const def = live.find((m) => m.value === 'default')?.resolved?.replace(/\[1m\]$/, '').replace(/-\d{8}$/, '');
      return { source: 'harness', models: models.map((m) => (m.value === def ? { ...m, tag: 'Default' } : m)) };
    });

    app.get('/api/settings', () => settings.get());

    app.patch('/api/settings', async (req) => {
      const next = await settings.update(settingsPatch.parse(req.body));
      bus.publish({ type: 'settings.updated', settings: next });
      return next;
    });
  };
