import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** apps/server */
export const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '../..');

/** SQLite file lives in apps/server/data (gitignored). Absolute so CLI and runtime agree. */
export function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const dir = resolve(SERVER_ROOT, 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return `file:${resolve(dir, 'cafe.db').split(sep).join('/')}`;
}
