#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '@agent-cafe/server/main';
import { openBrowser, probe } from './browser.js';
import { CliError, HELP, parseCliArgs } from './options.js';

// Next to this file in the built package: web/ (the UI) and migrations/.
const here = dirname(fileURLToPath(import.meta.url));

let options;
try {
  options = parseCliArgs(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  console.error(`agent-cafe: ${err.message}\n\n${HELP}`);
  process.exit(1);
}
if (options.help) {
  console.log(HELP);
  process.exit(0);
}
if (options.version) {
  console.log((JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as { version: string }).version);
  process.exit(0);
}

const url = `http://127.0.0.1:${options.port}`;
const open = () => options.openBrowser && openBrowser(url);

const running = await probe(url);
if (running === 'cafe') {
  console.log(`☕ Agent Café is already open at ${url}`);
  open();
  process.exit(0);
}
if (running === 'taken') {
  console.error(`agent-cafe: port ${options.port} is in use by another program. Try another one: agent-cafe --port ${options.port + 1}`);
  process.exit(1);
}

const workspaceDir = join(options.dataDir, 'workspace');
mkdirSync(workspaceDir, { recursive: true });
try {
  await startServer(
    { host: '127.0.0.1', port: options.port, workspaceDir, webDir: join(here, 'web') },
    { databaseUrl: `file:${join(options.dataDir, 'cafe.db').split(sep).join('/')}`, migrationsDir: join(here, 'migrations') },
  );
} catch (err) {
  if ((err as { code?: string }).code === 'EADDRINUSE') {
    console.error(`agent-cafe: port ${options.port} is in use. Try another one: agent-cafe --port ${options.port + 1}`);
    process.exit(1);
  }
  throw err;
}
console.log(`☕ Agent Café is open at ${url}`);
console.log(`   data: ${options.dataDir}`);
console.log('   Press Ctrl+C to close it.');
open();
