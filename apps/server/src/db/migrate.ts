import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { SERVER_ROOT } from '../paths.js';

/** prisma/migrations, from the repo. The packaged `agent-cafe` command ships its own copy. */
export const MIGRATIONS_DIR = resolve(SERVER_ROOT, 'prisma/migrations');

/**
 * Brings the database up to date at startup, so running the café needs no Prisma CLI.
 * Keeps Prisma Migrate's own bookkeeping table, so `prisma migrate dev` and this agree on what
 * has been applied. Returns the names of the migrations it applied.
 */
export function migrate(url: string, dir: string = MIGRATIONS_DIR): string[] {
  const sqlite = new Database(url.replace(/^file:/, ''));
  try {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" TEXT PRIMARY KEY NOT NULL,
      "checksum" TEXT NOT NULL,
      "finished_at" DATETIME,
      "migration_name" TEXT NOT NULL,
      "logs" TEXT,
      "rolled_back_at" DATETIME,
      "started_at" DATETIME NOT NULL DEFAULT current_timestamp,
      "applied_steps_count" INTEGER UNSIGNED NOT NULL DEFAULT 0
    )`);
    const rows = sqlite
      .prepare('SELECT migration_name AS name, finished_at AS finished FROM _prisma_migrations WHERE rolled_back_at IS NULL')
      .all() as Array<{ name: string; finished: number | null }>;
    const stuck = rows.find((r) => r.finished === null);
    if (stuck) throw new Error(`Database migration ${stuck.name} failed earlier. Fix or restore the database, then start again.`);
    const done = new Set(rows.map((r) => r.name));

    const migrations = existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'migration.sql')))
          .map((d) => d.name)
          .sort()
          .map((name) => {
            const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
            return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
          })
      : [];
    if (migrations.length === 0) throw new Error(`No database migrations found in ${dir}.`);

    const record = sqlite.prepare(
      'INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?)',
    );
    // Databases from before migrations existed were made with `prisma db push`, from whichever
    // schema was current then: bring them up to the first migration, then record it as applied.
    const pushed = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'Agent'").get();
    if (done.size === 0 && pushed) {
      const first = migrations[0]!;
      adopt(sqlite, first.sql);
      record.run(randomUUID(), first.checksum, first.name, Date.now(), Date.now(), 0);
      done.add(first.name);
    }

    const applied: string[] = [];
    for (const m of migrations) {
      if (done.has(m.name)) continue;
      const id = randomUUID();
      record.run(id, m.checksum, m.name, Date.now(), null, 0);
      try {
        sqlite.exec(m.sql);
      } catch (err) {
        sqlite.prepare('UPDATE _prisma_migrations SET logs = ? WHERE id = ?').run(String(err), id);
        throw new Error(`Database migration ${m.name} failed: ${(err as Error).message}`);
      }
      sqlite.prepare('UPDATE _prisma_migrations SET finished_at = ?, applied_steps_count = 1 WHERE id = ?').run(Date.now(), id);
      applied.push(m.name);
    }
    return applied;
  } finally {
    sqlite.close();
  }
}

type Schema = Map<string, { sql: string; columns: string[]; indexes: Map<string, string> }>;

function schemaOf(sqlite: Database.Database): Schema {
  const tables = sqlite
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> '_prisma_migrations'")
    .all() as Array<{ name: string; sql: string }>;
  const indexes = sqlite.prepare("SELECT name, tbl_name AS tbl, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL").all() as Array<{
    name: string;
    tbl: string;
    sql: string;
  }>;
  return new Map(
    tables.map((t) => [
      t.name,
      {
        sql: t.sql,
        columns: (sqlite.prepare('SELECT name FROM pragma_table_info(?)').all(t.name) as Array<{ name: string }>).map((c) => c.name),
        indexes: new Map(indexes.filter((i) => i.tbl === t.name).map((i) => [i.name, i.sql])),
      },
    ]),
  );
}

/**
 * Brings a `prisma db push` database to the schema `sql` creates, keeping its rows. Tables that
 * are missing are created; tables whose columns differ are rebuilt the way Prisma Migrate does it
 * (new table, copy the shared columns, swap). Fails, changing nothing, when existing rows can't
 * fit, such as a new required column with no default.
 */
function adopt(sqlite: Database.Database, sql: string): void {
  const reference = new Database(':memory:');
  let want: Schema;
  try {
    reference.exec(sql);
    want = schemaOf(reference);
  } finally {
    reference.close();
  }
  const have = schemaOf(sqlite);
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((c) => b.includes(c));

  // Off while tables are swapped, as SQLite requires; checked once everything is in place.
  const foreignKeys = sqlite.pragma('foreign_keys', { simple: true });
  sqlite.pragma('foreign_keys = OFF');
  try {
    sqlite.transaction(() => {
      for (const [name, table] of want) {
        const old = have.get(name);
        if (old && same(old.columns, table.columns)) {
          for (const [index, indexSql] of table.indexes) if (!old.indexes.has(index)) sqlite.exec(indexSql);
          continue;
        }
        if (old) {
          const temp = `_adopt_${name}`;
          sqlite.exec(table.sql.replace(/^CREATE TABLE "[^"]+"/, `CREATE TABLE "${temp}"`));
          const shared = table.columns.filter((c) => old.columns.includes(c)).map((c) => `"${c}"`).join(', ');
          try {
            sqlite.exec(`INSERT INTO "${temp}" (${shared}) SELECT ${shared} FROM "${name}"`);
          } catch (err) {
            throw new Error(`Can't upgrade this database's ${name} table: ${(err as Error).message}. Back it up and start with a new one.`);
          }
          sqlite.exec(`DROP TABLE "${name}"`);
          sqlite.exec(`ALTER TABLE "${temp}" RENAME TO "${name}"`);
        } else {
          sqlite.exec(table.sql);
        }
        for (const indexSql of table.indexes.values()) sqlite.exec(indexSql);
      }
      const broken = sqlite.pragma('foreign_key_check') as unknown[];
      if (broken.length) throw new Error(`Can't upgrade this database: ${broken.length} rows point at rows that don't exist.`);
    })();
  } finally {
    sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
