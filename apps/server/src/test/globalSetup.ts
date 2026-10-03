import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { TestProject } from 'vitest/node';

/** Builds one schema-synced SQLite template per test run; tests copy it (see testDb.ts). */
export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cafe-test-'));
  const template = join(dir, 'template.db');
  // SQLite accepts an empty file; avoid Prisma's missing-database probe on Windows.
  writeFileSync(template, '');
  // Use this project's Prisma and the same Node runtime as Vitest. An npx shim
  // can select a different runtime on Windows and hide schema-engine failures.
  execFileSync(process.execPath, [createRequire(import.meta.url).resolve('prisma/build/index.js'), 'db', 'push'], {
    env: { ...process.env, DATABASE_URL: `file:${template.split(sep).join('/')}` },
    stdio: 'pipe',
  });
  project.provide('templateDb', template);
  return () => rmSync(dir, { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
  }
}
