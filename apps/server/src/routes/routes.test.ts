import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { MockAdapter } from '../providers/mock.js';
import { createServices } from '../services.js';
import { fakeHarnesses } from '../test/fakeHarness.js';
import { testDb } from '../test/testDb.js';

const config: ServerConfig = { host: '127.0.0.1', port: 0, workspaceDir: '.' };

async function setup(harness: Parameters<typeof fakeHarnesses>[0] = 'signed_out') {
  const db = await testDb({ seed: true });
  const mock = new MockAdapter({ sleep: async () => {}, failRate: 0 });
  const services = createServices(config, db, { harnesses: fakeHarnesses(harness), resolveAdapter: async () => mock });
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
    expect(models).toEqual({ source: 'harness', models: [{ value: 'sonnet', label: 'Sonnet', description: 'Balanced' }] });
    const demo = (await app.inject('/api/providers/openai/models')).json();
    expect(demo.source).toBe('catalog');
  });

  it('sets an agent folder only when it exists', async () => {
    const { app, db } = await setup();
    const earl = await db.agent.findFirstOrThrow({ where: { name: 'Earl' } });
    const url = `/api/agents/${earl.id}`;
    expect((await app.inject({ method: 'PATCH', url, payload: { workDir: 'relative/path' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url, payload: { workDir: join(tmpdir(), 'no-such-folder-cafe') } })).statusCode).toBe(400);
    const dir = mkdtempSync(join(tmpdir(), 'cafe-work-'));
    const ok = await app.inject({ method: 'PATCH', url, payload: { workDir: dir, permission: 'acceptEdits' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ workDir: dir, permission: 'acceptEdits' });
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
});
