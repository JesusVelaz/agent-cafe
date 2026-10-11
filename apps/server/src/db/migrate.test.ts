import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { SERVER_ROOT } from '../paths.js';
import { migrate, MIGRATIONS_DIR } from './migrate.js';

const tempDb = () => join(mkdtempSync(join(tmpdir(), 'agent-cafe-migrate-')), 'cafe.db');
const tables = (file: string) => {
  const sqlite = new Database(file);
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map((r) => r.name);
  sqlite.close();
  return names;
};
const history = (file: string) => {
  const sqlite = new Database(file);
  const rows = sqlite.prepare('SELECT migration_name, finished_at, applied_steps_count, logs FROM _prisma_migrations ORDER BY started_at').all();
  sqlite.close();
  return rows as Array<{ migration_name: string; finished_at: number | null; applied_steps_count: number; logs: string | null }>;
};
/** The repo's migrations plus extra ones, in a temp folder. */
function withExtra(extra: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cafe-migrations-'));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  for (const [name, sql] of Object.entries(extra)) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'migration.sql'), sql);
  }
  return dir;
}

describe('migrate', () => {
  it('creates the schema on a new database, then has nothing left to do', () => {
    const file = tempDb();
    const first = migrate(file);
    expect(first).toHaveLength(1);
    expect(tables(file)).toEqual(expect.arrayContaining(['Agent', 'Task', '_prisma_migrations']));
    expect(migrate(file)).toEqual([]);
    expect(history(file)).toEqual([expect.objectContaining({ migration_name: first[0], applied_steps_count: 1, logs: null })]);
  });

  it('adopts a database made with `prisma db push` without re-creating its tables', () => {
    const file = tempDb();
    const [init] = migrate(tempDb());
    const sqlite = new Database(file);
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, init!, 'migration.sql'), 'utf8'));
    sqlite.close();

    expect(migrate(file)).toEqual([]);
    expect(history(file)).toEqual([expect.objectContaining({ migration_name: init, applied_steps_count: 0 })]);
  });

  it('upgrades a `prisma db push` database from an older schema, keeping its rows', () => {
    const file = tempDb();
    const [init] = migrate(tempDb());
    const sqlite = new Database(file);
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, init!, 'migration.sql'), 'utf8'));
    // As the schema was before thread titles and projects.
    sqlite.exec('DROP TABLE "Project"; ALTER TABLE "Task" DROP COLUMN "threadTitle"; DROP INDEX "Task_status_idx";');
    sqlite.exec(`INSERT INTO "Agent" ("id", "name", "providerId", "model", "systemPrompt", "spriteSeed") VALUES ('a', 'Ada', 'p', 'm', '', 1)`);
    sqlite.exec(`INSERT INTO "Task" ("id", "agentId", "providerId", "model", "prompt", "maxCostUsd") VALUES ('t', 'a', 'p', 'm', 'hi', 1)`);
    sqlite.close();

    expect(migrate(file)).toEqual([]);
    expect(history(file)).toEqual([expect.objectContaining({ migration_name: init, applied_steps_count: 0 })]);
    const upgraded = new Database(file);
    expect(upgraded.prepare('SELECT "id", "prompt", "threadTitle" FROM "Task"').all()).toEqual([{ id: 't', prompt: 'hi', threadTitle: null }]);
    expect(upgraded.prepare(`SELECT 1 FROM sqlite_master WHERE name IN ('Project', 'Task_status_idx')`).all()).toHaveLength(2);
    upgraded.close();
  });

  it("refuses to adopt a database whose rows can't fit the schema, leaving it as it was", () => {
    const file = tempDb();
    const sqlite = new Database(file);
    sqlite.exec('CREATE TABLE "Agent" ("id" TEXT NOT NULL PRIMARY KEY); INSERT INTO "Agent" VALUES (\'a\');');
    sqlite.close();

    expect(() => migrate(file)).toThrow(/Can't upgrade this database's Agent table/);
    expect(tables(file).sort()).toEqual(['Agent', '_prisma_migrations']);
    expect(history(file)).toEqual([]);
  });

  it('applies new migrations in order', () => {
    const file = tempDb();
    migrate(file);
    const dir = withExtra({ '29990102000000_b': 'CREATE TABLE "B" ("id" TEXT);', '29990101000000_a': 'CREATE TABLE "A" ("id" TEXT);' });
    expect(migrate(file, dir)).toEqual(['29990101000000_a', '29990102000000_b']);
    expect(tables(file)).toEqual(expect.arrayContaining(['A', 'B']));
  });

  it('records a failed migration and refuses to start until it is dealt with', () => {
    const file = tempDb();
    const dir = withExtra({ '29990101000000_bad': 'CREATE TABLE "Agent" ("id" TEXT);' });
    expect(() => migrate(file, dir)).toThrow(/29990101000000_bad failed: .*already exists/);
    expect(history(file).at(-1)).toMatchObject({ migration_name: '29990101000000_bad', finished_at: null, logs: expect.stringContaining('already exists') });
    expect(() => migrate(file, dir)).toThrow(/29990101000000_bad failed earlier/);
  });

  it('matches schema.prisma (add a migration with `pnpm db:migrate` after changing the schema)', () => {
    const file = tempDb();
    migrate(file);
    const prisma = createRequire(import.meta.url).resolve('prisma/build/index.js');
    // --exit-code: 0 when the migrated database already matches the schema, 2 when it doesn't.
    const diff = () =>
      execFileSync(process.execPath, [prisma, 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], {
        cwd: SERVER_ROOT,
        env: { ...process.env, DATABASE_URL: `file:${file.split(sep).join('/')}` },
        stdio: 'pipe',
      });
    expect(diff).not.toThrow();
  });
});
