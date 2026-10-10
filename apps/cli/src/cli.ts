#!/usr/bin/env node
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { startServer } from '@agent-cafe/server/main';
import { openBrowser, probe } from './browser.js';
import { remoteAddress, type RemoteKind } from './network.js';
import { CliError, HELP, parseCliArgs } from './options.js';
import { pairingToken } from './token.js';

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
const open = () => options.openBrowser && openBrowser(url);

const running = await probe(url);
if (running === 'cafe') {
  // The running café keeps the pairing code it started with, so a new one would change nothing yet.
  if (options.newToken) fail(`Agent Café is already open at ${url}. Close it (Ctrl+C in its window), then run this again to make a new pairing code.`);
  console.log(`☕ Agent Café is already open at ${url}`);
  if (options.host) console.log('   To open it to your phone, close it first, then start it again with --host.');
  open();
  process.exit(0);
}
if (running === 'taken') fail(`port ${options.port} is in use by another program. Try another one: agent-cafe --port ${options.port + 1}`);

const workspaceDir = join(options.dataDir, 'workspace');
mkdirSync(workspaceDir, { recursive: true });

let remote: { host: string; token: string; kind: RemoteKind } | undefined;
if (options.host) {
  try {
    const { address, kind } = remoteAddress(options.host);
    remote = { host: address, token: pairingToken(options.dataDir, options.newToken).token, kind };
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
    fail(err.message);
  }
} else if (options.newToken) {
  pairingToken(options.dataDir, true);
  console.log('Made a new pairing code. Devices paired before will need to scan again.');
}

let remoteUrl: string | undefined;
try {
  ({ remoteUrl } = await startServer(
    {
      host: '127.0.0.1',
      port: options.port,
      workspaceDir,
      webDir: join(here, 'web'),
      ...(remote ? { remote: { host: remote.host, token: remote.token } } : {}),
    },
    { databaseUrl: `file:${join(options.dataDir, 'cafe.db').split(sep).join('/')}`, migrationsDir: join(here, 'migrations') },
  ));
} catch (err) {
  const code = (err as { code?: string }).code;
  if (code === 'EADDRINUSE') fail(`port ${options.port} is in use. Try another one: agent-cafe --port ${options.port + 1}`);
  if (code === 'EADDRNOTAVAIL') fail(`${remote?.host} isn't available on this computer right now.`);
  throw err;
}

console.log(`☕ Agent Café is open at ${url}`);
console.log(`   data: ${options.dataDir}`);
if (remote && remoteUrl) {
  const link = `${remoteUrl}/?token=${remote.token}`;
  console.log('\n📱 To open it on your phone, scan this with the phone’s camera:\n');
  console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
  console.log(`   or open ${link}`);
  console.log('   Anyone with this code or link can control your café, so keep it to yourself.');
  console.log('   If it gets out, start with --new-token to sign out every paired device.');
  if (remote.kind === 'tailscale') {
    console.log('   Works wherever your phone has Tailscale on.');
  } else {
    console.log('   ⚠ Your phone has to be on the same network, and the connection isn’t encrypted:');
    console.log('     use this on a network you trust (your home), never on public Wi-Fi.');
    console.log('     To use the café from anywhere, encrypted, use --host tailscale.');
  }
  console.log('');
}
console.log('   Press Ctrl+C to close it.');
open();
