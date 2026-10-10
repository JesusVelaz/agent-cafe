import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { startServer } from './main.js';
import { REPO_ROOT } from './paths.js';

// Repo-root .env (Node's built-in loader; real env vars take precedence).
const envFile = resolve(REPO_ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();
const { url } = await startServer(config);
console.log(`☕ Agent Café server on ${url}`);
if (config.webDir) console.log(`   serving the café from ${config.webDir}`);
console.log(`   demo file tools read: ${config.workspaceDir}`);
