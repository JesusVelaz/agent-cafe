import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { createServices } from '../services.js';
import { fakeHarnesses } from '../test/fakeHarness.js';
import { testDb } from '../test/testDb.js';
import { displayPath, expandPath, listFolders } from './folders.js';
import { repoName } from './projects.js';

const tree = () => {
  const home = mkdtempSync(join(tmpdir(), 'cafe-home-'));
  for (const d of ['projects', 'Documents', '.cache', 'node_modules']) mkdirSync(join(home, d));
  mkdirSync(join(home, 'projects', 'web'));
  writeFileSync(join(home, 'notes.txt'), 'not a folder');
  return home;
};

describe('folder browser', () => {
  it('lists only visible folders, sorted, with ~ display paths', () => {
    const home = tree();
    const l = listFolders('~', home);
    expect(l.entries.map((e) => e.name)).toEqual(['Documents', 'projects']);
    expect(l.display).toBe('~/');
    const sub = listFolders('~/projects', home);
    expect(sub).toMatchObject({ display: '~/projects/', parent: home, entries: [{ name: 'web', path: join(home, 'projects', 'web') }] });
    expect(() => listFolders('~/nope', home)).toThrow(/doesn't exist/);
    expect(() => listFolders('~/notes.txt', home)).toThrow(/doesn't exist/);
  });

  it('expands and displays paths', () => {
    const home = join(tmpdir(), 'me');
    expect(expandPath('~', home)).toBe(home);
    expect(expandPath('~/a/b', home)).toBe(join(home, 'a', 'b'));
    expect(displayPath(join(home, 'a'), home)).toBe('~/a/');
    expect(displayPath(`${sep}elsewhere`, home)).toMatch(/elsewhere\/$/);
  });

  it('names a clone after its repository', () => {
    expect(repoName('https://github.com/acme/web.git')).toBe('web');
    expect(repoName('git@github.com:acme/api')).toBe('api');
    expect(repoName('https://gitlab.com/group/sub/tool/')).toBe('tool');
  });
});

describe('POST /api/projects/clone', () => {
  const config: ServerConfig = { host: '127.0.0.1', port: 0, workspaceDir: '.' };
  const setup = async () => {
    const db = await testDb({ seed: true });
    const app = await buildApp(createServices(config, db, { harnesses: fakeHarnesses() }));
    return { app, db };
  };

  it('clones into a new folder and adds it as a project', async () => {
    const { app } = await setup();
    const src = mkdtempSync(join(tmpdir(), 'cafe-src-'));
    execFileSync('git', ['init', '-q', src]);
    execFileSync('git', ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init']);
    const parent = mkdtempSync(join(tmpdir(), 'cafe-into-'));
    const url = pathToFileURL(src).href;
    const res = await app.inject({ method: 'POST', url: '/api/projects/clone', payload: { url, parent, name: 'copy' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'copy', path: join(parent, 'copy') });
    // Same destination again: refused, nothing overwritten.
    const again = await app.inject({ method: 'POST', url: '/api/projects/clone', payload: { url, parent, name: 'copy' } });
    expect(again.statusCode).toBe(409);
  });

  it('refuses URLs that are not remote repositories', async () => {
    const { app } = await setup();
    const parent = mkdtempSync(join(tmpdir(), 'cafe-into-'));
    for (const url of ['--upload-pack=calc', 'C:\\secret', '/etc', 'http://insecure.example/repo']) {
      const res = await app.inject({ method: 'POST', url: '/api/projects/clone', payload: { url, parent } });
      expect(res.statusCode, url).toBe(400);
    }
  });
});
