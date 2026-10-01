import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { HarnessService } from '../providers/harness.js';
import { MockAdapter } from '../providers/mock.js';
import { createServices } from '../services.js';
import { fakeHarnesses, fakeProbe } from '../test/fakeHarness.js';
import { testDb } from '../test/testDb.js';

const config: ServerConfig = { host: '127.0.0.1', port: 0, workspaceDir: '.' };

const opened: Array<{ title: string; exe: string; args: string[] }> = [];

async function setup(harness: Parameters<typeof fakeHarnesses>[0] = 'signed_out') {
  const db = await testDb({ seed: true });
  const mock = new MockAdapter({ sleep: async () => {}, failRate: 0 });
  const services = createServices(config, db, {
    harnesses: fakeHarnesses(harness, async (title, exe, args) => void opened.push({ title, exe, args })),
    resolveAdapter: async () => mock,
  });
  const app = await buildApp(services);
  return { app, services, db };
}

describe('HTTP API', () => {
  it('creates a task routed to any idle agent', async () => {
    const { app, services } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'hi', providerId: 'anthropic' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'queued', providerId: 'anthropic', isMock: true });
    await services.orchestrator.idle();
    const detail = await app.inject(`/api/tasks/${res.json().id}`);
    expect(detail.json().task.status).toBe('completed');
    expect(detail.json().events.length).toBeGreaterThan(3);
  });

  it('validates bodies', async () => {
    const { app } = await setup();
    expect((await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: '' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'x' } })).statusCode).toBe(400);
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/providers/openai', payload: { mode: 'turbo' } })).statusCode,
    ).toBe(400);
  });

  it('accepts no API keys', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'PATCH', url: '/api/providers/openai', payload: { apiKey: 'sk-proj-abcd' } });
    expect(res.statusCode).toBe(400);
  });

  it('reports harness status and models', async () => {
    const { app } = await setup('ready');
    const checked = (await app.inject({ method: 'POST', url: '/api/providers/anthropic/check' })).json();
    expect(checked).toMatchObject({ harness: 'claude-code', connection: { state: 'ready', account: 'barista@example.com' } });
    const models = (await app.inject('/api/providers/anthropic/models')).json();
    expect(models.source).toBe('harness');
    expect(models.models.map((m: { value: string }) => m.value)).toEqual(expect.arrayContaining(['claude-opus-5-5', 'claude-opus-4-8', 'claude-haiku-4-5']));
    expect(models.models.find((m: { value: string }) => m.value === 'claude-sonnet-5')).toMatchObject({ label: 'Sonnet 5', tag: 'Default' });
    const demo = (await app.inject('/api/providers/openai/models')).json();
    expect(demo.source).toBe('catalog');
  });

  it('offers Codex’s own model list on the ground floor once it’s signed in', async () => {
    const db = await testDb({ seed: true });
    const codexList = [{ value: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Flagship', tag: 'Default' }];
    const harnesses = new HarnessService({ anthropic: fakeProbe('ready'), openai: { ...fakeProbe('ready'), models: async () => codexList } }, async () => {});
    const app = await buildApp(createServices(config, db, { harnesses, resolveAdapter: async () => new MockAdapter({ sleep: async () => {}, failRate: 0 }) }));
    expect((await app.inject('/api/providers/openai/models')).json()).toEqual({ source: 'harness', models: codexList });
  });

  it('adds projects only for folders that exist, named after the folder', async () => {
    const { app } = await setup();
    const post = (payload: object) => app.inject({ method: 'POST', url: '/api/projects', payload });
    expect((await post({ path: 'relative/path' })).statusCode).toBe(400);
    expect((await post({ path: join(tmpdir(), 'no-such-folder-cafe') })).statusCode).toBe(400);
    const dir = mkdtempSync(join(tmpdir(), 'cafe-work-'));
    const created = await post({ path: `"${dir}"` });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ path: dir, name: basename(dir) });
    expect((await post({ path: dir })).json().id).toBe(created.json().id); // same folder, same project
    const renamed = await app.inject({ method: 'PATCH', url: `/api/projects/${created.json().id}`, payload: { name: 'Café' } });
    expect(renamed.json().name).toBe('Café');
    expect((await app.inject({ method: 'DELETE', url: `/api/projects/${created.json().id}` })).statusCode).toBe(204);
    expect((await app.inject('/api/projects')).json()).toEqual([]);
  });

  it('answers 409 for an approval that is not pending', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'POST', url: '/api/tasks/t1/approvals/a1', payload: { decision: 'allow' } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 409 when the provider is off', async () => {
    const { app } = await setup();
    await app.inject({ method: 'PATCH', url: '/api/providers/openai', payload: { mode: 'off' } });
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'x', providerId: 'openai' } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 for live mode while Claude Code is signed out', async () => {
    const { app } = await setup('signed_out');
    const res = await app.inject({ method: 'PATCH', url: '/api/providers/anthropic', payload: { mode: 'live' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/claude auth login/);
  });

  it('hires and archives agents', async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/agents',
      payload: { name: 'Cortado', providerId: 'openai', model: 'gpt-6-sol' },
    });
    expect(res.statusCode).toBe(201);
    const id = res.json().id;
    await app.inject({ method: 'PATCH', url: `/api/agents/${id}`, payload: { archived: true } });
    const list = await app.inject('/api/agents');
    expect(list.json().map((a: { id: string }) => a.id)).not.toContain(id);
  });

  it('cancels and retries', async () => {
    const { app, services } = await setup();
    const t = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'x', providerId: 'openai' } })).json();
    await services.orchestrator.idle();
    const retry = await app.inject({ method: 'POST', url: `/api/tasks/${t.id}/retry` });
    expect(retry.statusCode).toBe(201);
    expect(retry.json().retryOf).toBe(t.id);
    await services.orchestrator.idle();
    expect((await app.inject({ method: 'POST', url: '/api/tasks/nope/cancel' })).statusCode).toBe(404);
  });

  it('connects by opening the vendor sign-in in a terminal, and never takes credentials', async () => {
    const { app } = await setup('signed_out');
    opened.length = 0;
    const res = await app.inject({ method: 'POST', url: '/api/providers/anthropic/connect' });
    expect(res.statusCode).toBe(200);
    expect(opened).toEqual([{ title: 'Connect Claude', exe: '/usr/local/bin/claude', args: ['auth', 'login'] }]);
    const out = await app.inject({ method: 'POST', url: '/api/providers/openai/disconnect' });
    expect(out.json()).toMatchObject({ id: 'openai', harness: 'codex' });
  });

  it('connecting when already signed in opens nothing and tells every café', async () => {
    const { app, services } = await setup('ready');
    opened.length = 0;
    const seen: string[] = [];
    services.bus.subscribe((e) => e.type === 'provider.updated' && seen.push(`${e.provider.id}:${e.provider.connection.state}`));
    const res = await app.inject({ method: 'POST', url: '/api/providers/anthropic/connect' });
    expect(res.statusCode).toBe(200);
    expect(opened).toEqual([]);
    // A café showing a stale "Not connected" catches up even though the server saw no change.
    expect(seen).toContain('anthropic:ready');
  });

  it('refuses changes from other websites', async () => {
    const { app } = await setup();
    const evil = await app.inject({ method: 'POST', url: '/api/providers/anthropic/connect', headers: { origin: 'https://evil.example' } });
    expect(evil.statusCode).toBe(403);
    const ours = await app.inject({ method: 'POST', url: '/api/providers/anthropic/check', headers: { origin: 'http://localhost:3000' } });
    expect(ours.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/providers', headers: { origin: 'https://evil.example' } })).statusCode).toBe(200);
  });

  it('renames an agent and changes their look and model', async () => {
    const { app, db } = await setup();
    const earl = await db.agent.findFirstOrThrow({ where: { name: 'Earl' } });
    const url = `/api/agents/${earl.id}`;
    const res = await app.inject({ method: 'PATCH', url, payload: { name: 'Espresso', spriteSeed: 4242, model: 'claude-sonnet-5' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Espresso', spriteSeed: 4242, model: 'claude-sonnet-5' });
    expect((await app.inject({ method: 'PATCH', url, payload: { name: '   ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url, payload: { spriteSeed: 0 } })).statusCode).toBe(400);
  });
});
