/**
 * Read-only file tools, sandboxed to WORKSPACE_DIR.
 * Paths are resolved *and* realpath'd, so `..` segments and symlinks can't escape.
 */
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

const MAX_READ_BYTES = 64 * 1024;
const MAX_LIST_ENTRIES = 200;

export class SandboxError extends Error {}

async function resolveInside(workspaceDir: string, userPath: string): Promise<string> {
  const root = await realpath(workspaceDir);
  let real: string;
  try {
    real = await realpath(resolve(root, userPath));
  } catch {
    // Don't reveal whether something exists outside the sandbox.
    const lexical = relative(root, resolve(root, userPath));
    if (lexical.startsWith('..') || isAbsolute(lexical)) throw new SandboxError('Path is outside the workspace.');
    throw new SandboxError(`Not found: ${userPath}`);
  }
  const rel = relative(root, real);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new SandboxError('Path is outside the workspace.');
  return real;
}

export async function listFiles(workspaceDir: string, path = '.'): Promise<string> {
  const dir = await resolveInside(workspaceDir, path);
  const entries = await readdir(dir, { withFileTypes: true });
  const lines = entries
    .filter((e) => !e.name.startsWith('.'))
    .slice(0, MAX_LIST_ENTRIES)
    .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
    .sort();
  if (lines.length === 0) return '(empty folder)';
  const more = entries.length > MAX_LIST_ENTRIES ? `\n… ${entries.length - MAX_LIST_ENTRIES} more` : '';
  return lines.join('\n') + more;
}

export async function readTextFile(workspaceDir: string, path: string): Promise<string> {
  const file = await resolveInside(workspaceDir, path);
  const info = await stat(file);
  if (!info.isFile()) throw new SandboxError(`${path} is not a file.`);
  const buf = await readFile(file);
  if (buf.subarray(0, 8192).includes(0)) throw new SandboxError(`${path} looks like a binary file.`);
  const text = buf.subarray(0, MAX_READ_BYTES).toString('utf8');
  return buf.length > MAX_READ_BYTES ? `${text}\n… [truncated at 64 KB of ${info.size} bytes]` : text;
}
