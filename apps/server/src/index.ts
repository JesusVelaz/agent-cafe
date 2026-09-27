import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db/client.js';
import { seed } from './db/seed.js';
import { REPO_ROOT } from './paths.js';
import { createServices } from './services.js';

// Repo-root .env (Node's built-in loader; real env vars take precedence).
const envFile = resolve(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const db = createDb();
await seed(db); // idempotent: first run gets the starting crew
const services = createServices(config, db);
await services.orchestrator.recover();
services.ambient.start();

const app = await buildApp(services);
await app.listen({ host: config.host, port: config.port });
console.log(`☕ Agent Café server on http://${config.host}:${config.port}`);
console.log(`   workspace (read-only for agents): ${config.workspaceDir}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  services.ambient.stop();
  await services.orchestrator.shutdown();
  await app.close();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
