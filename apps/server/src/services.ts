import type { ServerConfig } from './config.js';
import type { Db } from './db/client.js';
import { EventBus } from './events/bus.js';
import { AmbientDriver } from './orchestrator/ambient.js';
import { Orchestrator } from './orchestrator/orchestrator.js';
import { ProviderConfigService } from './providers/config.js';
import { createAdapterResolver, type AdapterResolver } from './providers/registry.js';
import { loadOrCreateMasterKey } from './secrets/vault.js';
import { SettingsService } from './settings.js';
import { createToolRegistry } from './tools/registry.js';

export interface Services {
  db: Db;
  bus: EventBus;
  providers: ProviderConfigService;
  settings: SettingsService;
  orchestrator: Orchestrator;
  ambient: AmbientDriver;
  resolveAdapter: AdapterResolver;
}

/** Composition root: wires the orchestration layer together. */
export function createServices(
  config: ServerConfig,
  db: Db,
  overrides: { masterKey?: Buffer; resolveAdapter?: AdapterResolver } = {},
): Services {
  const bus = new EventBus();
  const masterKey = overrides.masterKey ?? loadOrCreateMasterKey(config.homeDir);
  const providers = new ProviderConfigService(db, config.envKeys, masterKey);
  const settings = new SettingsService(db);
  const tools = createToolRegistry({ db, workspaceDir: config.workspaceDir });
  const resolveAdapter = overrides.resolveAdapter ?? createAdapterResolver(providers);
  const orchestrator = new Orchestrator({ db, bus, providers, settings, tools, resolveAdapter });
  const ambient = new AmbientDriver({ db, orchestrator, providers, settings });
  return { db, bus, providers, settings, orchestrator, ambient, resolveAdapter };
}
