// Builds the publishable `agent-cafe` package into dist/: the server and its workspace code
// bundled into one file, plus the built web UI and the database migrations next to it.
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const web = join(here, '../web/out');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const pkg = readJson(join(here, 'package.json'));
const server = readJson(join(here, '../server/package.json'));

// Bundled rather than installed: the Claude Agent SDK's package pulls in a copy of Claude Code
// (hundreds of MB per platform) that the café never runs, since it always uses the installed `claude`.
const bundled = ['@anthropic-ai/claude-agent-sdk'];
// The server's other npm packages stay real dependencies of agent-cafe (a native SQLite driver,
// Prisma's runtime), so they must match the server's.
const external = Object.keys(server.dependencies).filter((name) => !name.startsWith('@agent-cafe/') && !bundled.includes(name));
const mismatched = external.filter((name) => pkg.dependencies?.[name] !== server.dependencies[name]);
const stray = bundled.filter((name) => pkg.dependencies?.[name]);
if (stray.length) throw new Error(`apps/cli/package.json must not depend on ${stray.join(', ')}: the build bundles it.`);
if (mismatched.length) {
  throw new Error(`apps/cli/package.json dependencies must match apps/server's. Out of step: ${mismatched.join(', ')}`);
}
if (!existsSync(join(web, 'index.html'))) throw new Error('No built web UI in apps/web/out. Run `pnpm build` from the repo root.');

rmSync(dist, { recursive: true, force: true });
await build({
  entryPoints: [join(here, 'src/cli.ts')],
  outfile: join(dist, 'cli.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external,
  // Bundled CommonJS packages call require(); give the ES module one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: 'warning',
});
cpSync(web, join(dist, 'web'), { recursive: true });
cpSync(join(here, '../server/prisma/migrations'), join(dist, 'migrations'), { recursive: true });
console.log(`Built agent-cafe ${pkg.version} into ${dist}`);
