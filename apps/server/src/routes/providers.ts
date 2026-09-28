import { CATALOG_AS_OF, MODEL_CATALOG, PROVIDER_IDS, modelsFor, type HarnessModelDTO } from '@agent-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services.js';

const idParam = z.object({ id: z.enum(PROVIDER_IDS) });

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

    /** Models the floor's harness offers when signed in; the demo catalog otherwise. */
    app.get('/api/providers/:id/models', async (req): Promise<{ source: 'harness' | 'catalog'; models: HarnessModelDTO[] }> => {
      const { id } = idParam.parse(req.params);
      const live = await providers.harnesses.models(id).catch(() => []);
      if (live.length) return { source: 'harness', models: live };
      return { source: 'catalog', models: modelsFor(id).map((m) => ({ value: m.id, label: m.label, description: m.tier })) };
    });

    app.get('/api/settings', () => settings.get());

    app.patch('/api/settings', async (req) => {
      const next = await settings.update(settingsPatch.parse(req.body));
      bus.publish({ type: 'settings.updated', settings: next });
      return next;
    });
  };
