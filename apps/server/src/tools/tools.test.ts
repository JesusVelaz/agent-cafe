import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { testDb } from '../test/testDb.js';
import { evaluate } from './calculator.js';
import { createToolRegistry } from './registry.js';

describe('calculator', () => {
  it.each([
    ['2+3*4', 14],
    ['(1+2)^2', 9],
    ['2^3^2', 512],
    ['-4 + 10 / 4', -1.5],
    ['17 % 5', 2],
    ['1.5e0', 1.5],
  ])('%s = %d', (expr, want) => {
    expect(evaluate(expr as string)).toBe(want);
  });

  it.each(['process.exit()', '2 +', '1/0', 'constructor', '(1'])('rejects %s', (expr) => {
    expect(() => evaluate(expr)).toThrow();
  });
});

async function registry() {
  const workspaceDir = mkdtempSync(join(tmpdir(), 'cafe-ws-'));
  writeFileSync(join(workspaceDir, 'hello.txt'), 'hi there');
  mkdirSync(join(workspaceDir, 'docs'));
  writeFileSync(join(workspaceDir, 'docs', 'plan.md'), '# plan');
  writeFileSync(join(workspaceDir, 'blob.bin'), Buffer.from([0, 1, 2, 0]));
  const db = await testDb();
  return createToolRegistry({ db, workspaceDir });
}

describe('tool registry', () => {
  it('exposes a spec per tool', async () => {
    const tools = await registry();
    expect(tools.specs.map((s) => s.name).sort()).toEqual(
      ['calculator', 'current_time', 'list_files', 'notes_read', 'notes_write', 'read_file'].sort(),
    );
  });

  it('reads files inside the workspace', async () => {
    const tools = await registry();
    expect(await tools.execute('read_file', { path: 'docs/plan.md' })).toEqual({ ok: true, output: '# plan' });
    const listing = await tools.execute('list_files', {});
    expect(listing.ok).toBe(true);
    expect(listing.output).toContain('hello.txt');
    expect(listing.output).toContain('docs/');
  });

  it.each(['../secret.txt', '/etc/passwd', 'C:\\Windows\\win.ini', 'docs/../../x'])(
    'refuses to escape the workspace: %s',
    async (path) => {
      const tools = await registry();
      const res = await tools.execute('read_file', { path });
      expect(res.ok).toBe(false);
      expect(res.output).toMatch(/outside the workspace|not found/i);
    },
  );

  it('refuses binary files', async () => {
    const tools = await registry();
    expect((await tools.execute('read_file', { path: 'blob.bin' })).ok).toBe(false);
  });

  it('writes and reads notes', async () => {
    const tools = await registry();
    expect((await tools.execute('notes_write', { key: 'todo', content: 'buy beans' })).ok).toBe(true);
    expect(await tools.execute('notes_read', { key: 'todo' })).toEqual({ ok: true, output: 'buy beans' });
    expect((await tools.execute('notes_read', {})).output).toContain('todo');
  });

  it('returns validation errors as tool errors instead of throwing', async () => {
    const tools = await registry();
    const res = await tools.execute('calculator', { nope: 1 });
    expect(res.ok).toBe(false);
  });
});
