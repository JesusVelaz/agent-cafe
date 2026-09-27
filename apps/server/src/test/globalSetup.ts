import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import type { TestProject } from 'vitest/node';

/** Builds one schema-synced SQLite template per test run; tests copy it (see testDb.ts). */
export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cafe-test-'));
  const template = join(dir, 'template.db');
  execSync('npx prisma db push', {
    env: { ...process.env, DATABASE_URL: `file:${template.split(sep).join('/')}` },
    stdio: 'ignore',
  });
  project.provide('templateDb', template);
  return () => rmSync(dir, { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
  }
}
