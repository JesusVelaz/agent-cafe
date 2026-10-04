import type { CafeEvent } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { MockAdapter } from '../providers/mock.js';
import { abortError } from '../providers/types.js';
import { createServices } from '../services.js';
import { fakeHarnesses } from '../test/fakeHarness.js';
import { testDb } from '../test/testDb.js';

const config: ServerConfig = { host: '127.0.0.1', port: 0, workspaceDir: '.' };

async function setup(sleep: (ms: number, signal?: AbortSignal) => Promise<void> = async () => {}) {
  const db = await testDb({ seed: true });
  const mock = new MockAdapter({ sleep, failRate: 0 });
  const services = createServices(config, db, { harnesses: fakeHarnesses('signed_out'), resolveAdapter: async () => mock });
  const app = await buildApp(services);
  const published: CafeEvent[] = [];
  services.bus.subscribe((e) => published.push(e));
  return { app, services, db, published };
}

let clock = Date.parse('2026-10-01T09:00:00Z');

/** A finished task, created a second after the previous one. */
async function task(db: Db, agent: string, fields: Partial<Parameters<Db['task']['create']>[0]['data']> = {}) {
  const a = await db.agent.findFirstOrThrow({ where: { name: agent } });
  clock += 1000;
  return db.task.create({
    data: {
      agentId: a.id, providerId: a.providerId, model: a.model, prompt: `${agent} work`, maxCostUsd: 1,
      status: 'completed', isMock: true, createdAt: new Date(clock), finishedAt: new Date(clock), ...fields,
    } as Parameters<Db['task']['create']>[0]['data'],
  });
}

describe('thread settings', () => {
  it('renames and pins a thread on its first task, given any task in it', async () => {
    const { app, db, published } = await setup();
    const first = await task(db, 'Earl');
    const followUp = await task(db, 'Earl', { continueOf: first.id });
    const retried = await task(db, 'Earl', { continueOf: first.id, retryOf: followUp.id });

    const res = await app.inject({ method: 'PATCH', url: `/api/threads/${retried.id}`, payload: { title: '  Fix login  ', pinned: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: first.id, threadTitle: 'Fix login', threadPinnedAt: expect.any(String), threadArchivedAt: null });
    expect(published).toContainEqual({ type: 'task.upserted', task: expect.objectContaining({ id: first.id, threadTitle: 'Fix login' }) });
    expect((await db.task.findUniqueOrThrow({ where: { id: retried.id } })).threadTitle).toBeNull();
  });

  it('archives, unpins and resets the name', async () => {
    const { app, db } = await setup();
    const first = await task(db, 'Earl', { threadTitle: 'Old name', threadPinnedAt: new Date() });
    const res = await app.inject({ method: 'PATCH', url: `/api/threads/${first.id}`, payload: { title: ' ', pinned: false, archived: true } });
    expect(res.json()).toMatchObject({ threadTitle: null, threadPinnedAt: null, threadArchivedAt: expect.any(String) });
    const back = await app.inject({ method: 'PATCH', url: `/api/threads/${first.id}`, payload: { archived: false } });
    expect(back.json()).toMatchObject({ threadArchivedAt: null });
  });

  it('rejects unknown threads and bad settings', async () => {
    const { app, db } = await setup();
    const first = await task(db, 'Earl');
    expect((await app.inject({ method: 'PATCH', url: '/api/threads/nope', payload: { pinned: true } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'PATCH', url: `/api/threads/${first.id}`, payload: { pinned: 'yes' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/threads/${first.id}`, payload: { color: 'red' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: '/api/threads/nope' })).statusCode).toBe(404);
  });

  it('brings an archived thread back when it gets a follow-up', async () => {
    const { app, db, services } = await setup();
    const earl = await db.agent.findFirstOrThrow({ where: { name: 'Earl' } });
    const first = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'hi', agentId: earl.id } })).json();
    await services.orchestrator.idle();
    await app.inject({ method: 'PATCH', url: `/api/threads/${first.id}`, payload: { archived: true } });
    await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'and then?', agentId: earl.id, continueTaskId: first.id } });
    await services.orchestrator.idle();
    expect((await db.task.findUniqueOrThrow({ where: { id: first.id } })).threadArchivedAt).toBeNull();
  });
});

describe('deleting a thread', () => {
  it('removes the thread and the threads it delegated, but not messages in other conversations', async () => {
    const { app, db, published } = await setup();
    const first = await task(db, 'Earl');
    const followUp = await task(db, 'Earl', { continueOf: first.id });
    const delegated = await task(db, 'Mocha', { sourceTaskId: followUp.id, exchangeKind: 'delegation', rootTaskId: first.id, exchangeDepth: 1 });
    const nested = await task(db, 'Chai', { sourceTaskId: delegated.id, exchangeKind: 'delegation', rootTaskId: first.id, exchangeDepth: 2 });
    const result = await task(db, 'Earl', { continueOf: followUp.id, sourceTaskId: delegated.id, exchangeKind: 'result', resultForTaskId: delegated.id });
    const chaiThread = await task(db, 'Chai');
    const message = await task(db, 'Chai', { continueOf: chaiThread.id, sourceTaskId: followUp.id, exchangeKind: 'message', rootTaskId: first.id });
    const unrelated = await task(db, 'Earl');
    await db.taskEvent.create({ data: { taskId: first.id, seq: 0, kind: 'status', payload: '{"kind":"status","status":"queued"}' } });

    const res = await app.inject({ method: 'DELETE', url: `/api/threads/${followUp.id}` });
    expect(res.statusCode).toBe(200);
    const removed = [first, followUp, result, delegated, nested].map((t) => t.id).sort();
    expect([...res.json().removed].sort()).toEqual(removed);
    expect((await db.task.findMany({ select: { id: true } })).map((t) => t.id).sort()).toEqual([chaiThread.id, message.id, unrelated.id].sort());
    expect(await db.taskEvent.count({ where: { taskId: first.id } })).toBe(0);
    const event = published.find((e) => e.type === 'task.removed');
    expect(event && [...(event as { taskIds: string[] }).taskIds].sort()).toEqual(removed);
  });

  it('stops running work first', async () => {
    // A demo run that only ends when it's aborted.
    const hang = (_ms: number, signal?: AbortSignal) =>
      new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(abortError()), { once: true }));
    const { app, db, services } = await setup(hang);
    const earl = await db.agent.findFirstOrThrow({ where: { name: 'Earl' } });
    const running = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'long job', agentId: earl.id } })).json();
    const queued = (await app.inject({ method: 'POST', url: '/api/tasks', payload: { prompt: 'next', agentId: earl.id, continueTaskId: running.id } })).json();
    await expect.poll(async () => (await db.task.findUniqueOrThrow({ where: { id: running.id } })).status).toBe('running');

    const res = await app.inject({ method: 'DELETE', url: `/api/threads/${running.id}` });
    expect(res.statusCode).toBe(200);
    expect([...res.json().removed].sort()).toEqual([running.id, queued.id].sort());
    await services.orchestrator.idle();
    expect(await db.task.count({ where: { agentId: earl.id } })).toBe(0);
    expect(await db.taskEvent.count({ where: { taskId: { in: [running.id, queued.id] } } })).toBe(0);
  });
});

describe('snapshot', () => {
  it('loads each thread back to its first task, and every pinned thread', async () => {
    const { db, services } = await setup();
    const pinned = await task(db, 'Matcha', { threadPinnedAt: new Date() });
    const pinnedReply = await task(db, 'Matcha', { continueOf: pinned.id });
    const first = await task(db, 'Earl');
    for (let i = 0; i < 110; i++) await task(db, 'Scone');
    const latest = await task(db, 'Earl', { continueOf: first.id });

    const ids = new Set((await services.orchestrator.snapshot()).tasks.map((t) => t.id));
    expect(ids.has(latest.id)).toBe(true);
    expect(ids.has(first.id)).toBe(true);
    expect(ids.has(pinned.id)).toBe(true);
    expect(ids.has(pinnedReply.id)).toBe(true);
  });
});
