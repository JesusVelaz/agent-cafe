import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import { migrate } from '../db/migrate.js';

/** Builds one migrated SQLite template per test run; tests copy it (see testDb.ts). */
export default function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-cafe-test-'));
  const template = join(dir, 'template.db');
  // The same migrations the server applies at startup.
  migrate(template);
  project.provide('templateDb', template);
  return () => rmSync(dir, { recursive: true, force: true });
}

declare module 'vitest' {
  export interface ProvidedContext {
    templateDb: string;
  }
}
