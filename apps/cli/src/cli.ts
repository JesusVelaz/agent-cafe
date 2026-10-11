#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '@agent-cafe/server/main';
import { RemoteSetupError } from '@agent-cafe/server/network';
import { pairingToken } from '@agent-cafe/server/token';
import { call, findPort, openBrowser, probe, type PortUse } from './browser.js';
import { CliError, HELP, parseCliArgs } from './options.js';

// Next to this file in the built package: web/ (the UI) and migrations/.
const here = dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  console.error(`agent-cafe: ${message}`);
  process.exit(1);
}

let options;
try {
  options = parseCliArgs(process.argv.slice(2));
} catch (err) {
  if (!(err instanceof CliError)) throw err;
  fail(`${err.message}\n\n${HELP}`);
}
if (options.help) {
  console.log(HELP);
  process.exit(0);
}
if (options.version) {
  console.log((JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as { version: string }).version);
  process.exit(0);
}

// The command to suggest: from the repo it's `pnpm start`, installed it's `agent-cafe`.
const command = process.env.npm_lifecycle_event === 'start' ? 'pnpm start' : 'agent-cafe';
const inTheWay = (use: PortUse) => (use === 'dev' ? 'a café started with pnpm dev' : 'another program');

// Unless a port was asked for, step past ports other programs hold (an open café is reused).
const found = await findPort(options.port, options.portChosen ? 1 : 10, (port) => probe(`http://127.0.0.1:${port}`));
if (found.port === undefined) {
  const last = found.busy.at(-1)!;
  fail(
    options.portChosen
      ? `port ${last.port} is in use by ${inTheWay(last.use)}. Close it, or try another port: ${command} --port ${last.port + 1}`
      : `ports ${options.port}–${last.port} are all in use. Close what's using port ${options.port} (${inTheWay(found.busy[0]!.use)}), or pick a port: ${command} --port 5318`,
  );
}
const port = found.port;
const running = found.use;
if (port !== options.port) console.log(`Port ${options.port} is in use by ${inTheWay(found.busy[0]!.use)}, so the café is using port ${port}.`);

const url = `http://127.0.0.1:${port}`;
const open = () => (options.openBrowser ? openBrowser(url) : Promise.resolve());

// The QR code, link and network warnings live in the café (Settings → Connections), not here.
const phoneHint = (phoneOn: boolean) =>
  phoneOn
    ? '   Phone access is on: open Settings → Connections in the café for the QR code and details.'
    : '   To use it on your phone, open Settings → Connections in the café.';

if (running === 'cafe') {
  // The running café keeps the pairing code it started with, so a new one would change nothing yet.
  if (options.newToken) fail(`Agent Café is already open at ${url}. Close it (Ctrl+C in its window), then run this again to make a new pairing code.`);
  console.log(`☕ Agent Café is already open at ${url}`);
  if (options.host) {
    // Ask the running café to open to phones, as Settings → Connections does.
    const res = await call(`${url}/api/phone`, { method: 'POST', json: { via: options.host }, timeoutMs: 10_000 }).catch(() => undefined);
    let body: { sharing?: unknown; error?: string } = {};
    try {
      body = JSON.parse(res?.body ?? '{}');
    } catch {
      // Not the café's JSON: handled below.
    }
    if (res?.status === 404) fail('This café is an older version. Close it, then start it again with --host.');
    if (res?.status !== 200 || !body.sharing) fail(body.error ?? 'The café couldn’t open to your phone.');
    console.log(phoneHint(true));
  }
  await open();
  process.exit(0);
}

const workspaceDir = join(options.dataDir, 'workspace');
mkdirSync(workspaceDir, { recursive: true });

if (options.newToken) {
  pairingToken(options.dataDir, true);
  if (!options.host) console.log('Made a new pairing code. Devices paired before will need to scan again.');
}

let phone: unknown;
try {
  ({ phone } = await startServer(
    {
      host: '127.0.0.1',
      port,
      workspaceDir,
      webDir: join(here, 'web'),
      dataDir: options.dataDir,
      ...(options.host ? { phone: options.host } : {}),
    },
    { databaseUrl: `file:${join(options.dataDir, 'cafe.db').split(sep).join('/')}`, migrationsDir: join(here, 'migrations') },
  ));
} catch (err) {
  if (err instanceof RemoteSetupError) fail(err.message);
  if ((err as { code?: string }).code === 'EADDRINUSE') fail(`port ${port} is in use. Close what's using it, or try another port: ${command} --port ${port + 1}`);
  throw err;
}

console.log(`☕ Agent Café is running at ${url}`);
console.log(phoneHint(Boolean(phone)));
console.log('   Press Ctrl+C to close it.');
void open();
