import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import { MockAdapter } from '../providers/mock.js';
import { createServices } from '../services.js';
import { testDb } from '../test/testDb.js';

const config: ServerConfig = { host: '127.0.0.1', port: 0, homeDir: '.', workspaceDir: '.', envKeys: {} };

async function setup() {
  const db = await testDb({ seed: true });
  const mock = new MockAdapter({ sleep: async () => {}, failRate: 0 });
  const services = createServices(config, db, { masterKey: randomBytes(32), resolveAdapter: async () => mock });
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

  it('never returns API keys', async () => {
    const { app } = await setup();
    const key = 'sk-proj-super-secret-abcd';
    const res = await app.inject({ method: 'PATCH', url: '/api/providers/openai', payload: { apiKey: key } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(key);
    expect(res.json()).toMatchObject({ hasKey: true, keyHint: 'sk-…abcd' });
    const all = await app.inject('/api/providers');
    expect(all.body).not.toContain(key);
  });

  it('returns 409 when the provider is off', async () => {
    const { app } = await setup();
    await app.inject({ method: 'PATCH', url: '/api/providers/openai', payload: { mode: 'off' } });
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'x', providerId: 'openai' } });
    expect(res.statusCode).toBe(409);
  });

  it('returns 400 for live mode without a key', async () => {
    const { app } = await setup();
    const res = await app.inject({ method: 'PATCH', url: '/api/providers/openai', payload: { mode: 'live' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/API key/);
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
