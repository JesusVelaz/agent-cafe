import { PROVIDER_IDS } from '@agent-cafe/shared';
import { buildApp } from './app.js';
import type { ServerConfig } from './config.js';
import { createDb } from './db/client.js';
import { migrate, MIGRATIONS_DIR } from './db/migrate.js';
import { seed } from './db/seed.js';
import { databaseUrl } from './paths.js';
import { PhoneAccess, type PhoneSharing } from './phone.js';
import { createServices } from './services.js';

export interface StartOptions {
  databaseUrl?: string;
  migrationsDir?: string;
}

/**
 * Starts the café server: database, agents, harness checks and the HTTP API. Returns its URL, and
 * the pairing link when it was asked to open to phones from the start.
 */
export async function startServer(config: ServerConfig, options: StartOptions = {}): Promise<{ url: string; phone?: PhoneSharing }> {
  const url = options.databaseUrl ?? databaseUrl();
  migrate(url, options.migrationsDir ?? MIGRATIONS_DIR);
  const db = createDb(url);
  await seed(db); // idempotent: first run gets the starting crew
  const services = createServices(config, db);
  await services.orchestrator.recover();
  services.ambient.start();
  // Check each floor's harness (installed? signed in?) in the background; the UI updates when it lands.
  for (const id of PROVIDER_IDS) {
    void services.providers.harnesses
      .check(id)
      .then(() => services.providers.status(id))
      .then((provider) => services.bus.publish({ type: 'provider.updated', provider }))
      .catch((err) => console.error(`[harness] ${id} check failed`, err));
  }

  // Phones need the built UI to load, and a data folder to keep the pairing token in.
  const phone = new PhoneAccess(config.port, config.webDir ? config.dataDir : undefined);
  const app = await buildApp(services, {
    port: config.port,
    ...(config.webDir ? { webDir: config.webDir } : {}),
    remote: phone.current,
    phone,
  });
  phone.attach(app);
  async function close() {
    services.ambient.stop();
    services.providers.harnesses.close();
    await services.orchestrator.shutdown();
    await phone.stop();
    await app.close();
    await db.$disconnect();
  }

  let sharing: PhoneSharing | undefined;
  try {
    await app.listen({ host: config.host, port: config.port });
    if (config.phone) sharing = await phone.start(config.phone);
  } catch (err) {
    await close();
    throw err;
  }

  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    await close();
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return { url: `http://${config.host}:${config.port}`, ...(sharing ? { phone: sharing } : {}) };
}
