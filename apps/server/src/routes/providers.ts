import { CATALOG_AS_OF, MODEL_CATALOG, PROVIDER_IDS, type ProviderId } from '@agent-cafe/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Services } from '../services.js';

const idParam = z.object({ id: z.enum(PROVIDER_IDS) });

const providerPatch = z
  .object({
    mode: z.enum(['live', 'mock', 'off']).optional(),
    apiKey: z.string().max(500).optional(),
    clearKey: z.boolean().optional(),
    dailyCapUsd: z.number().min(0).max(10_000).optional(),
  })
  .strict();

const settingsPatch = z.object({ ambient: z.boolean().optional() }).strict();

/** Providers, settings and the model catalog. Responses never include API keys. */
export const providerRoutes =
  ({ providers, settings, bus, resolveAdapter }: Services): FastifyPluginAsync =>
  async (app) => {
    app.get('/api/catalog', async () => ({ asOf: CATALOG_AS_OF, models: MODEL_CATALOG }));

    app.get('/api/providers', () => providers.all());

    app.patch('/api/providers/:id', async (req) => {
      const { id } = idParam.parse(req.params);
      const provider = await providers.update(id, providerPatch.parse(req.body));
      bus.publish({ type: 'provider.updated', provider });
      return provider;
    });

    app.post('/api/providers/:id/test', async (req) => {
      const { id } = idParam.parse(req.params);
      const mode = await providers.mode(id as ProviderId);
      try {
        const adapter = await resolveAdapter(id, mode === 'off' ? 'live' : mode);
        return await adapter.testConnection();
      } catch (err) {
        return { ok: false, message: (err as Error).message };
      }
    });

    app.get('/api/settings', () => settings.get());

    app.patch('/api/settings', async (req) => {
      const next = await settings.update(settingsPatch.parse(req.body));
      bus.publish({ type: 'settings.updated', settings: next });
      return next;
    });
  };
