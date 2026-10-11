import type { ServerConfig } from './config.js';
import type { Db } from './db/client.js';
import { EventBus } from './events/bus.js';
import { AmbientDriver } from './orchestrator/ambient.js';
import { Orchestrator, type OrchestratorDeps } from './orchestrator/orchestrator.js';
import { ProviderConfigService } from './providers/config.js';
import { HarnessService } from './providers/harness.js';
import { createAdapterResolver, type AdapterResolver } from './providers/registry.js';
import { createToolRegistry } from './tools/registry.js';

export interface Services {
  db: Db;
  bus: EventBus;
  providers: ProviderConfigService;
  orchestrator: Orchestrator;
  ambient: AmbientDriver;
  resolveAdapter: AdapterResolver;
}

/** Composition root: wires the orchestration layer together. */
export function createServices(
  config: ServerConfig,
  db: Db,
  overrides: { harnesses?: HarnessService; resolveAdapter?: AdapterResolver; runLive?: OrchestratorDeps['runLive'] } = {},
): Services {
  const bus = new EventBus();
  const providers = new ProviderConfigService(db, overrides.harnesses ?? new HarnessService());
  // Any change in a harness's sign-in reaches every open café right away.
  providers.harnesses.onChange((id) => {
    void providers.status(id).then((provider) => bus.publish({ type: 'provider.updated', provider }));
  });
  const tools = createToolRegistry({ db, workspaceDir: config.workspaceDir });
  const resolveAdapter = overrides.resolveAdapter ?? createAdapterResolver();
  const orchestrator = new Orchestrator({
    db, bus, providers, tools, resolveAdapter,
    ...(overrides.runLive ? { runLive: overrides.runLive } : {}),
  });
  const ambient = new AmbientDriver({ db, orchestrator, providers });
  return { db, bus, providers, orchestrator, ambient, resolveAdapter };
}
