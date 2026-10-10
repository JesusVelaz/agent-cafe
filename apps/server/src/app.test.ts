import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('health', () => {
  it('responds ok', async () => {
    const app = await buildApp();
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});

describe('serving the built UI', () => {
  const webDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-cafe-web-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Agent Café</title>');
    mkdirSync(join(dir, '_next'));
    writeFileSync(join(dir, '_next', 'app.js'), 'console.log(1)');
    return dir;
  };

  it('serves the page and its files next to the API', async () => {
    const app = await buildApp(undefined, { webDir: webDir() });
    const page = await app.inject('/');
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toMatch(/^text\/html/);
    expect((await app.inject('/_next/app.js')).body).toBe('console.log(1)');
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
  });

  it('answers other page paths with the page, but unknown API paths with a JSON 404', async () => {
    const app = await buildApp(undefined, { webDir: webDir() });
    const deep = await app.inject('/some/where');
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('Agent Café');
    const api = await app.inject('/api/nope');
    expect(api.statusCode).toBe(404);
    expect(api.json()).toEqual({ error: 'Not found' });
  });

  it('refuses to start without a built UI', async () => {
    await expect(buildApp(undefined, { webDir: mkdtempSync(join(tmpdir(), 'agent-cafe-empty-')) })).rejects.toThrow(/pnpm build/);
  });
});

describe('origins', () => {
  const change = (app: Awaited<ReturnType<typeof buildApp>>, origin: string) =>
    app.inject({ method: 'POST', url: '/api/health', headers: { host: '127.0.0.1:4400', origin } }).then((r) => r.statusCode);

  it("accepts changes from the dev UI and the server's own port, nothing else", async () => {
    const app = await buildApp(undefined, { port: 4400 });
    expect(await change(app, 'http://localhost:3000')).not.toBe(403);
    expect(await change(app, 'http://127.0.0.1:4400')).not.toBe(403);
    expect(await change(app, 'http://localhost:4400')).not.toBe(403);
    expect(await change(app, 'http://127.0.0.1:4401')).toBe(403);
    expect(await change(app, 'https://example.com')).toBe(403);
  });
});
