// Builds Agents Café as a self-contained app for the computer it runs on, so people can install
// it without Node or pnpm: the café bundled into one file, the web UI, the database migrations,
// the native SQLite driver, and the same Node runtime this script runs on (so the driver fits it).
// Run `pnpm build` first. The release workflow runs this once per OS and architecture.
//
//   release/agent-cafe/                    the app folder (the Windows installer packs this)
//   release/agent-cafe-<os>-<arch>.tar.gz  the same folder, archived (macOS and Linux)
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '../web/out');
const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'));
const { platform, arch, version: nodeVersion } = process;
const os = { win32: 'windows', darwin: 'macos', linux: 'linux' }[platform];
if (!os || !['x64', 'arm64'].includes(arch)) throw new Error(`No standalone build for ${platform}-${arch}.`);
if (!existsSync(join(web, 'index.html'))) throw new Error('No built web UI in apps/web/out. Run `pnpm build` from the repo root.');

const release = join(here, 'release');
const out = join(release, 'agent-cafe');
const app = join(out, 'app');
rmSync(release, { recursive: true, force: true });
mkdirSync(app, { recursive: true });

// Everything but the SQLite driver goes into one file. Bundled CommonJS packages still call
// require(), which an ES module doesn't have, so the bundle makes one.
await build({
  entryPoints: [join(here, 'src/cli.ts')],
  outfile: join(app, 'cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['better-sqlite3'],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});
cpSync(web, join(app, 'web'), { recursive: true });
cpSync(join(here, '../server/prisma/migrations'), join(app, 'migrations'), { recursive: true });
// cli.mjs reads its version from the package.json one folder up.
writeFileSync(join(out, 'package.json'), `${JSON.stringify({ name: pkg.name, version: pkg.version, private: true }, null, 2)}\n`);
cpSync(join(here, 'installer/agent-cafe.png'), join(out, 'agent-cafe.png')); // the Linux menu icon

// The SQLite driver as pnpm installed it for this machine: its code, its compiled addon, and the
// one package it loads at runtime (bindings, which needs file-uri-to-path).
const modules = join(app, 'node_modules');
const copyPackage = (from, name, parts) => {
  const dir = dirname(createRequire(join(from, 'package.json')).resolve(`${name}/package.json`));
  for (const part of ['package.json', 'LICENSE', ...parts]) {
    if (existsSync(join(dir, part))) cpSync(join(dir, part), join(modules, name, part), { recursive: true });
  }
  return dir;
};
const sqlite = copyPackage(join(here, '../server'), 'better-sqlite3', ['lib', 'build/Release/better_sqlite3.node']);
const bindings = copyPackage(sqlite, 'bindings', ['bindings.js']);
copyPackage(bindings, 'file-uri-to-path', ['index.js']);

// Node itself, from nodejs.org, checked against the published checksums.
const nodeName = `node-${nodeVersion}-${platform === 'win32' ? 'win' : platform}-${arch}`;
const nodeFile = `${nodeName}.${platform === 'win32' ? 'zip' : 'tar.gz'}`;
const download = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't download ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
};
const sums = (await download(`https://nodejs.org/dist/${nodeVersion}/SHASUMS256.txt`)).toString();
const expected = sums.split('\n').find((line) => line.endsWith(`  ${nodeFile}`))?.split(' ')[0];
const archive = await download(`https://nodejs.org/dist/${nodeVersion}/${nodeFile}`);
if (!expected || createHash('sha256').update(archive).digest('hex') !== expected) throw new Error(`Checksum mismatch for ${nodeFile}`);
const unpack = join(release, 'node-download');
mkdirSync(unpack);
writeFileSync(join(unpack, nodeFile), archive);
// Windows' own tar (bsdtar) reads zips; a Git for Windows tar earlier on PATH wouldn't.
const tar = platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
execFileSync(tar, ['-xf', nodeFile], { cwd: unpack });
const nodeDir = join(unpack, nodeName);
const node = platform === 'win32' ? 'node.exe' : 'node';
cpSync(join(nodeDir, platform === 'win32' ? node : `bin/${node}`), join(out, node));
cpSync(join(nodeDir, 'LICENSE'), join(out, 'NODE-LICENSE'));
rmSync(unpack, { recursive: true, force: true });

// A launcher that runs the café on the Node next to it.
if (platform === 'win32') {
  writeFileSync(join(out, 'agent-cafe.cmd'), '@echo off\r\ntitle Agents Cafe\r\n"%~dp0node.exe" "%~dp0app\\cli.mjs" %*\r\n');
} else {
  writeFileSync(
    join(out, 'agent-cafe'),
    `#!/bin/sh
# Starts Agents Café on the Node runtime installed next to this script (following symlinks to it).
self=$0
while [ -L "$self" ]; do
  link=$(readlink "$self")
  case $link in /*) self=$link ;; *) self=$(dirname "$self")/$link ;; esac
done
here=$(cd "$(dirname "$self")" && pwd)
exec "$here/node" "$here/app/cli.mjs" "$@"
`,
  );
  chmodSync(join(out, 'agent-cafe'), 0o755);
  execFileSync('tar', ['-czf', `agent-cafe-${os}-${arch}.tar.gz`, 'agent-cafe'], { cwd: release });
}

// The bundled app must start and open its database: it has no node_modules to fall back on.
const reported = execFileSync(join(out, node), [join(app, 'cli.mjs'), '--version']).toString().trim();
if (reported !== pkg.version) throw new Error(`The standalone app reported version ${reported}, expected ${pkg.version}`);
const port = 40000 + Math.floor(Math.random() * 20000);
const dataDir = join(release, 'smoke-test-data');
const cafe = spawn(join(out, node), [join(app, 'cli.mjs'), '--no-browser', '--port', String(port), '--data-dir', dataDir], { stdio: 'inherit' });
try {
  let agents;
  for (let i = 0; i < 60 && !agents; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (cafe.exitCode !== null) throw new Error(`The standalone app exited with code ${cafe.exitCode}`);
    agents = await fetch(`http://127.0.0.1:${port}/api/agents`).then((r) => (r.ok ? r.json() : null), () => null);
  }
  if (!agents?.length) throw new Error('The standalone app did not serve its agents.');
} finally {
  cafe.kill();
  await new Promise((r) => (cafe.exitCode !== null ? r() : cafe.once('exit', r)));
  rmSync(dataDir, { recursive: true, force: true });
}
console.log(`Built standalone agent-cafe ${pkg.version} for ${os}-${arch} (Node ${nodeVersion}) into ${release}`);
