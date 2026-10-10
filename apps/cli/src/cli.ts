#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { startServer } from '@agent-cafe/server/main';
import { RemoteSetupError } from '@agent-cafe/server/network';
import { pairingToken } from '@agent-cafe/server/token';
import { call, openBrowser, probe } from './browser.js';
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

const url = `http://127.0.0.1:${options.port}`;
const open = () => (options.openBrowser ? openBrowser(url) : Promise.resolve());

interface PhoneSharing {
  via: 'tailscale' | 'lan' | 'address';
  link: string;
  firewall: { fixable: boolean } | null;
}

async function printPairing({ via, link, firewall }: PhoneSharing) {
  console.log('\n📱 To open it on your phone, scan this with the phone’s camera:\n');
  console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
  console.log(`   or open ${link}`);
  console.log('   Anyone with this code or link can control your café, so keep it to yourself.');
  console.log('   If it gets out, start with --new-token to sign out every paired device.');
  if (via === 'tailscale') {
    console.log('   Works wherever your phone has Tailscale on.');
  } else {
    console.log('   ⚠ Your phone has to be on the same network, and the connection isn’t encrypted:');
    console.log('     use this on a network you trust (your home), never on public Wi-Fi.');
    console.log('     To use the café from anywhere, encrypted, use --host tailscale.');
  }
  if (firewall) {
    console.log('   ⚠ Windows Firewall will stop your phone from loading the café.');
    console.log(firewall.fixable ? '     To fix it, click “Phone” in the café, then “Fix it”.' : '     This network is managed by your organization: ask your IT team to allow Agent Café.');
  }
  console.log('');
}

const running = await probe(url);
if (running === 'cafe') {
  // The running café keeps the pairing code it started with, so a new one would change nothing yet.
  if (options.newToken) fail(`Agent Café is already open at ${url}. Close it (Ctrl+C in its window), then run this again to make a new pairing code.`);
  console.log(`☕ Agent Café is already open at ${url}`);
  if (options.host) {
    // Ask the running café to open to phones, as its "Connect your phone" button does.
    const res = await call(`${url}/api/phone`, { method: 'POST', json: { via: options.host }, timeoutMs: 10_000 }).catch(() => undefined);
    let body: { sharing?: PhoneSharing; error?: string } = {};
    try {
      body = JSON.parse(res?.body ?? '{}');
    } catch {
      // Not the café's JSON: handled below.
    }
    if (res?.status === 404) fail('This café is an older version. Close it, then start it again with --host.');
    if (res?.status !== 200 || !body.sharing) fail(body.error ?? 'The café couldn’t open to your phone.');
    await printPairing(body.sharing);
  }
  await open();
  process.exit(0);
}
if (running === 'taken') fail(`port ${options.port} is in use by another program. Try another one: agent-cafe --port ${options.port + 1}`);

const workspaceDir = join(options.dataDir, 'workspace');
mkdirSync(workspaceDir, { recursive: true });

if (options.newToken) {
  pairingToken(options.dataDir, true);
  if (!options.host) console.log('Made a new pairing code. Devices paired before will need to scan again.');
}

let phone: PhoneSharing | undefined;
try {
  ({ phone } = await startServer(
    {
      host: '127.0.0.1',
      port: options.port,
      workspaceDir,
      webDir: join(here, 'web'),
      dataDir: options.dataDir,
      ...(options.host ? { phone: options.host } : {}),
    },
    { databaseUrl: `file:${join(options.dataDir, 'cafe.db').split(sep).join('/')}`, migrationsDir: join(here, 'migrations') },
  ));
} catch (err) {
  if (err instanceof RemoteSetupError) fail(err.message);
  if ((err as { code?: string }).code === 'EADDRINUSE') fail(`port ${options.port} is in use. Try another one: agent-cafe --port ${options.port + 1}`);
  throw err;
}

console.log(`☕ Agent Café is open at ${url}`);
console.log(`   data: ${options.dataDir}`);
if (phone) await printPairing(phone);
else console.log('   To use it on your phone, click “Phone” in the café, or start it with --host lan.');
console.log('   Press Ctrl+C to close it.');
void open();
