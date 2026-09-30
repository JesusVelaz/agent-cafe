/**
 * The folder browser behind "Add project": lists directories (never files, never
 * their contents), and can reveal a folder in the OS file manager. Paths go out in a
 * display form (`~/…`, forward slashes) plus the real absolute path.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { OrchestratorError } from '../orchestrator/orchestrator.js';

/** Windows: the list of drives sits above every drive root. */
export const DRIVES = '::drives';
const MAX_ENTRIES = 500;

export interface FolderListing {
  path: string;
  display: string;
  parent: string | null;
  /** The parent in display form ("~/", "C:/", "This PC/"), for stepping up. */
  parentDisplay: string | null;
  entries: Array<{ name: string; path: string }>;
}

/** `~`, `~/x`, `C:/x`, `/x` → an absolute native path. Relative paths are resolved from home. */
export function expandPath(p: string, home = homedir()): string {
  const t = p.trim().replace(/^"(.*)"$/, '$1');
  if (!t || t === '~') return home;
  if (t.startsWith('~/') || t.startsWith('~\\')) return resolve(home, t.slice(2));
  return isAbsolute(t) ? resolve(t) : resolve(home, t);
}

/** Absolute path → `~/projects/app/` style, forward slashes, trailing slash. */
export function displayPath(abs: string, home = homedir()): string {
  let d = abs;
  if (d === home || d.startsWith(home + sep)) d = '~' + d.slice(home.length);
  d = d.split(sep).join('/');
  return d.endsWith('/') ? d : `${d}/`;
}

const hidden = (name: string) => name.startsWith('.') || name.startsWith('$') || name === 'System Volume Information' || name === 'node_modules';

export function listFolders(input: string, home = homedir()): FolderListing {
  if (input === DRIVES && process.platform === 'win32') {
    const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => existsSync(d));
    return { path: DRIVES, display: 'This PC/', parent: null, parentDisplay: null, entries: drives.map((d) => ({ name: d.slice(0, 2), path: d })) };
  }
  const abs = expandPath(input, home);
  let isDir = false;
  try {
    isDir = statSync(abs).isDirectory();
  } catch {
    /* missing */
  }
  if (!isDir) throw new OrchestratorError("That folder doesn't exist.", 'not_found');
  let names: string[] = [];
  try {
    names = readdirSync(abs, { withFileTypes: true })
      // Real directories only: skips files and the junctions/links Windows puts in a profile.
      .filter((d) => d.isDirectory() && !hidden(d.name))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
      .slice(0, MAX_ENTRIES);
  } catch {
    throw new OrchestratorError("Can't open that folder (no permission).", 'invalid');
  }
  const up = dirname(abs);
  const parent = up !== abs ? up : process.platform === 'win32' ? DRIVES : null;
  return {
    path: abs,
    display: displayPath(abs, home),
    parent,
    parentDisplay: parent === DRIVES ? 'This PC/' : parent ? displayPath(parent, home) : null,
    entries: names.map((name) => ({ name, path: join(abs, name) })),
  };
}

function reveal(abs: string) {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [abs]] : process.platform === 'darwin' ? ['open', [abs]] : ['xdg-open', [abs]];
  const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

const listQuery = z.object({ path: z.string().max(2000).default('~') });
const revealBody = z.object({ path: z.string().min(1).max(2000) }).strict();

export const folderRoutes = (): FastifyPluginAsync => async (app) => {
  app.get('/api/folders', async (req) => listFolders(listQuery.parse(req.query).path));

  /** Opens the folder in Explorer / Finder. */
  app.post('/api/folders/reveal', async (req) => {
    const abs = expandPath(revealBody.parse(req.body).path);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new OrchestratorError("That folder doesn't exist.", 'not_found');
    reveal(abs);
    return { ok: true };
  });
};
