import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { inject } from 'vitest';
import { createDb, type Db } from '../db/client.js';
import { seed } from '../db/seed.js';

/** A fresh, isolated database (optionally seeded) for one test. */
export async function testDb(opts: { seed?: boolean } = {}): Promise<Db> {
  const file = join(mkdtempSync(join(tmpdir(), 'agent-cafe-db-')), 'test.db');
  copyFileSync(inject('templateDb'), file);
  const db = createDb(`file:${file.split(sep).join('/')}`);
  if (opts.seed) await seed(db);
  return db;
}
