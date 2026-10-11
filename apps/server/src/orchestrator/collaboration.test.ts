import { afterEach, describe, expect, it } from 'vitest';
import type { TaskDTO } from '@agent-cafe/shared';
import { EventBus } from '../events/bus.js';
import { ProviderConfigService } from '../providers/config.js';
import type { LiveRunContext, LiveRunners } from '../providers/live.js';
import { fakeHarnesses } from '../test/fakeHarness.js';
import { fakeProbe } from '../test/fakeHarness.js';
import { HarnessService } from '../providers/harness.js';
import { testDb } from '../test/testDb.js';
import { sleep } from '../providers/types.js';
import { Collaboration } from './collaboration.js';
import { Orchestrator } from './orchestrator.js';
import type { RunOutcome } from './runner.js';

const completed = (output: string): RunOutcome => ({ status: 'completed', output, totals: { inputTokens: 0, outputTokens: 0, steps: 1, costUsd: null } });
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const fn of cleanups.splice(0)) await fn(); });

async function setup(runLive?: Partial<LiveRunners>, harnesses = fakeHarnesses('ready')) {
  const db = await testDb({ seed: true });
  const providers = new ProviderConfigService(db, harnesses);
  await providers.update('anthropic', { mode: 'live' });
  await providers.update('openai', { mode: 'live' });
  const project = await db.project.create({ data: { name: 'Collaboration', path: process.cwd() } });
  const agents = await db.agent.findMany({ where: { name: { in: ['Earl', 'Mocha', 'Chai'] } } });
  const earl = agents.find((a) => a.name === 'Earl')!;
  const mocha = agents.find((a) => a.name === 'Mocha')!;
  const chai = agents.find((a) => a.name === 'Chai')!;
  const orch = new Orchestrator({ db, providers, bus: new EventBus(), tools: { specs: [], execute: async () => ({ ok: true, output: '' }) },
    resolveAdapter: async () => { throw new Error('Live tasks should use their harness'); }, runLive,
  });
  cleanups.push(async () => { await orch.shutdown(); await db.$disconnect(); });
  return { db, providers, project, earl, mocha, chai, orch };
}

async function waitFor(fn: () => Promise<boolean>) {
  for (let i = 0; i < 500; i++) { if (await fn()) return; await sleep(5); }
  throw new Error('Timed out');
}

describe('cross-harness collaboration', () => {
  it('repairs a stale Codex model before delegation starts and keeps the visible result plain', async () => {
    const available = [
      { value: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Default', tag: 'Default' },
      { value: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', description: 'Fast' },
    ];
    const harnesses = new HarnessService({ anthropic: fakeProbe(), openai: { ...fakeProbe(), models: async () => available } });
    let target = '';
    let delegatedModel = '';
    const { db, project, earl, chai, orch } = await setup({
      anthropic: async (ctx) => {
        ctx.onSession?.('original');
        if (ctx.task.prompt === 'Say test') await ctx.collaboration!.call('cafe_delegate_task', { agentId: target, message: 'Reply test' });
        return completed('test');
      },
      openai: async (ctx) => { delegatedModel = ctx.task.model; return completed('test'); },
    }, harnesses);
    target = chai.id;
    const root = await orch.enqueue({ target: { agentId: earl.id }, projectId: project.id, prompt: 'Say test' });
    await orch.idle();
    expect(delegatedModel).toBe('gpt-5.6-luna');
    expect((await db.agent.findUniqueOrThrow({ where: { id: chai.id } })).model).toBe('gpt-5.6-luna');
    const delegated = await db.task.findFirstOrThrow({ where: { exchangeKind: 'delegation' } });
    expect(delegated).toMatchObject({ prompt: 'Reply test', model: 'gpt-5.6-luna', status: 'completed' });
    const result = await db.task.findFirstOrThrow({ where: { exchangeKind: 'result' } });
    expect(result.prompt).toBe('test');
    expect(JSON.parse(result.exchangeData!)).toMatchObject({ senderName: 'Chai', status: 'completed' });
    expect(await db.taskEvent.count({ where: { taskId: delegated.id, kind: 'log' } })).toBe(1);
    await expect(orch.enqueue({ target: { agentId: chai.id }, projectId: project.id, prompt: 'test', model: 'unavailable-explicit-model' })).rejects.toThrow('available');
    const historical = await db.task.create({ data: {
      agentId: chai.id, providerId: 'openai', model: 'gpt-6-luna', prompt: 'Reply test', maxCostUsd: 0.5,
      status: 'failed', projectId: project.id, sourceTaskId: root.id, rootTaskId: root.id, exchangeDepth: 1, exchangeKind: 'delegation',
    } });
    const retry = await orch.retry(historical.id);
    await orch.idle();
    expect(retry).toMatchObject({ model: 'gpt-5.6-luna', sourceTaskId: root.id, exchangeKind: 'delegation' });
    expect(await db.task.count({ where: { resultForTaskId: retry.id } })).toBe(1);
  });
  it('Claude delegates to Codex and automatically resumes with the attributed result', async () => {
    const seen: LiveRunContext[] = [];
    let recipient = '';
    const { db, project, earl, mocha, orch } = await setup({
      anthropic: async (ctx) => {
        seen.push(ctx);
        ctx.onSession?.('claude-session');
        if (ctx.task.prompt === 'Implement and get a review') {
          await ctx.collaboration!.call('cafe_delegate_task', { agentId: recipient, message: 'Review only; do not edit.' });
          return completed('Review pending');
        }
        return completed('Review incorporated');
      },
      openai: async (ctx) => { seen.push(ctx); ctx.onSession?.('codex-thread'); return completed('Found an edge case'); },
    });
    recipient = mocha.id;
    await db.agent.update({ where: { id: earl.id }, data: { permission: 'acceptEdits' } });
    const root = await orch.enqueue({ target: { agentId: earl.id }, projectId: project.id, prompt: 'Implement and get a review' });
    await orch.idle();
    const tasks = await db.task.findMany({ orderBy: { createdAt: 'asc' } });
    expect(tasks).toHaveLength(3);
    const delegated = tasks.find((t) => t.exchangeKind === 'delegation')!;
    const result = tasks.find((t) => t.exchangeKind === 'result')!;
    expect(delegated).toMatchObject({ agentId: mocha.id, sourceTaskId: root.id, rootTaskId: root.id, projectId: project.id, permission: 'ask', continueOf: null, status: 'completed' });
    expect(result).toMatchObject({ agentId: earl.id, continueOf: root.id, resultForTaskId: delegated.id, status: 'completed' });
    expect(result.prompt).toContain('Found an edge case');
    expect(result.prompt).toBe('Found an edge case');
    expect(JSON.parse(result.exchangeData!)).toEqual({ senderName: 'Mocha', senderProviderId: 'openai', status: 'completed' });
    expect(seen.find((c) => c.task.prompt.includes('Delegation result'))?.resume).toBe('claude-session');
    expect(seen.find((c) => c.task.prompt.includes('Delegation result'))?.task.prompt).toContain('Continue the original request');
    expect(seen.find((c) => c.task.prompt.includes('Delegated task'))?.resume).toBeUndefined();
    const logs = await db.taskEvent.findMany({ where: { taskId: root.id, kind: 'log' } });
    expect(logs.some((e) => e.payload.includes('Delegated task to Mocha'))).toBe(true);
    await orch.recover();
    await orch.idle();
    expect(await db.task.count()).toBe(3); // recovery never sends the same result twice
  });

  it('a coordinator dispatches two harnesses concurrently and receives both results', async () => {
    let targets: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const started: string[] = [];
    const runner = async (ctx: LiveRunContext): Promise<RunOutcome> => {
      ctx.onSession?.('coordinator-session');
      if (ctx.task.prompt === 'Coordinate') {
        await Promise.all(targets.map((agentId) => ctx.collaboration!.call('cafe_delegate_task', { agentId, message: 'Inspect a separate area; read only.' })));
        return completed('Two tasks pending');
      }
      if (ctx.task.prompt.includes('[Delegated task')) {
        started.push(ctx.task.prompt);
        await gate;
        return completed('Inspection done');
      }
      return completed('Result collected');
    };
    const { db, project, earl, mocha, chai, orch } = await setup({ anthropic: runner, openai: runner });
    targets = [earl.id, mocha.id];
    await orch.enqueue({ target: { agentId: chai.id }, projectId: project.id, prompt: 'Coordinate' });
    await waitFor(async () => started.length === 2);
    expect(await db.task.count({ where: { exchangeKind: 'delegation', status: 'running' } })).toBe(2);
    release();
    await orch.idle();
    expect(await db.task.count({ where: { exchangeKind: 'result', agentId: chai.id, status: 'completed' } })).toBe(2);
  });

  it('lets Codex explicitly reply to a message from Claude in the original conversation', async () => {
    let recipient = '';
    let sender = '';
    let replyResume: string | undefined;
    const { db, project, earl, mocha, orch } = await setup({
      anthropic: async (ctx) => {
        ctx.onSession?.('message-session');
        if (ctx.task.prompt === 'Ask a teammate') await ctx.collaboration!.call('cafe_send_message', { agentId: recipient, message: 'Which test covers this?' });
        else replyResume = ctx.resume;
        return completed('Thanks');
      },
      openai: async (ctx) => {
        await ctx.collaboration!.call('cafe_send_message', { agentId: sender, message: 'The cancellation test covers it.' });
        return completed('Reply sent');
      },
    });
    recipient = mocha.id;
    sender = earl.id;
    const root = await orch.enqueue({ target: { agentId: earl.id }, projectId: project.id, prompt: 'Ask a teammate' });
    await orch.idle();
    expect(await db.task.count({ where: { exchangeKind: 'message' } })).toBe(2);
    expect(await db.task.count({ where: { exchangeKind: 'result' } })).toBe(0);
    const reply = await db.task.findFirstOrThrow({ where: { agentId: earl.id, exchangeKind: 'message' } });
    expect(reply.continueOf).toBe(root.id);
    expect(replyResume).toBe('message-session');
  });

  it('cancels outstanding delegated work without waking the cancelled requester', async () => {
    let recipient = '';
    const { db, project, earl, mocha, orch } = await setup({
      anthropic: async (ctx) => {
        await ctx.collaboration!.call('cafe_delegate_task', { agentId: recipient, message: 'Long review' });
        await sleep(10_000, ctx.signal).catch(() => {});
        return { status: 'cancelled', totals: completed('').totals };
      },
      openai: async (ctx) => { await sleep(10_000, ctx.signal).catch(() => {}); return { status: 'cancelled', totals: completed('').totals }; },
    });
    recipient = mocha.id;
    const root = await orch.enqueue({ target: { agentId: earl.id }, projectId: project.id, prompt: 'Coordinate' });
    await waitFor(async () => await db.task.count({ where: { exchangeKind: 'delegation', status: 'running' } }) === 1);
    await orch.cancel(root.id);
    await orch.idle();
    expect(await db.task.count({ where: { status: 'cancelled' } })).toBe(2);
    expect(await db.task.count({ where: { exchangeKind: 'result' } })).toBe(0);
  });

  it('delivers failure information and recovers a result missed while the provider was off', async () => {
    const { db, providers, project, earl, mocha, orch } = await setup({ anthropic: async () => completed('Recovered') });
    const root = await db.task.create({ data: { agentId: earl.id, providerId: 'anthropic', model: earl.model, prompt: 'Review', projectId: project.id, maxCostUsd: 0.5, status: 'completed', sessionId: 'prior-session' } });
    const child = await db.task.create({ data: { agentId: mocha.id, providerId: 'openai', model: mocha.model, prompt: 'Review', maxCostUsd: 0.5, status: 'failed', error: 'Usage limit reached', sourceTaskId: root.id, exchangeKind: 'delegation', rootTaskId: root.id, exchangeDepth: 1 } });
    await providers.update('anthropic', { mode: 'off' });
    await orch.recover();
    expect(await db.task.count({ where: { resultForTaskId: child.id } })).toBe(0);
    await providers.update('anthropic', { mode: 'live' });
    await orch.recover();
    await orch.idle();
    const result = await db.task.findUniqueOrThrow({ where: { resultForTaskId: child.id } });
    expect(result.prompt).toContain('Usage limit reached');
    expect(result.continueOf).toBe(root.id);
    await orch.recover();
    expect(await db.task.count({ where: { resultForTaskId: child.id } })).toBe(1);
  });

  it('cancels descendants through completed parents and keeps cancellation durable on recovery', async () => {
    const { db, earl, mocha, chai, orch } = await setup();
    const task = async (agent: typeof earl, data: Record<string, unknown>) => db.task.create({ data: {
      agentId: agent.id, providerId: agent.providerId, model: agent.model, prompt: 'Review', maxCostUsd: 0.5, status: 'completed', ...data,
    } });
    const root = await task(earl, {});
    const child = await task(mocha, { sourceTaskId: root.id, rootTaskId: root.id, exchangeKind: 'delegation', exchangeDepth: 1 });
    const grandchild = await task(chai, { sourceTaskId: child.id, rootTaskId: root.id, exchangeKind: 'delegation', exchangeDepth: 2, status: 'queued' });
    await orch.cancel(root.id);
    expect((await db.task.findUniqueOrThrow({ where: { id: grandchild.id } })).status).toBe('cancelled');
    expect((await db.task.findUniqueOrThrow({ where: { id: root.id } })).collaborationCancelled).toBe(true);
    await orch.recover();
    expect(await db.task.count({ where: { exchangeKind: 'result' } })).toBe(0);
  });
});

describe('collaboration boundaries', () => {
  async function scope() {
    const { db, project, earl, mocha, chai } = await setup();
    const source = await db.task.create({ data: { agentId: earl.id, providerId: 'anthropic', model: earl.model, prompt: 'Root', projectId: project.id, maxCostUsd: 0.5, status: 'running' } });
    const router = new Collaboration({ db, mode: async () => 'live', log: async () => {}, enqueue: async (input) => {
      const row = await db.task.create({ data: { agentId: (input.target as { agentId: string }).agentId, providerId: 'openai', model: 'default', prompt: input.prompt, maxCostUsd: 0.5, projectId: input.projectId, ...(input.collaboration ?? {}) } });
      return { id: row.id } as TaskDTO;
    } });
    const ac = new AbortController();
    return { db, source, earl, mocha, chai, router, ac, tools: router.forTask(source.id, ac.signal) };
  }

  it('rejects impersonation, self delegation, unrelated task reads, and calls after cancellation', async () => {
    const { db, source, earl, mocha, ac, tools } = await scope();
    await expect(tools.call('cafe_delegate_task', { agentId: mocha.id, message: 'Review', senderId: 'forged' })).rejects.toThrow();
    await expect(tools.call('cafe_delegate_task', { agentId: earl.id, message: 'Review' })).rejects.toThrow('yourself');
    const unrelated = await db.task.create({ data: { agentId: mocha.id, providerId: 'openai', model: 'default', prompt: 'Private', maxCostUsd: 0.5 } });
    await expect(tools.call('cafe_get_task', { taskId: unrelated.id })).rejects.toThrow('outside');
    expect(await tools.call('cafe_get_task', { taskId: source.id })).toMatchObject({ status: 'running' });
    ac.abort();
    await expect(tools.call('cafe_list_agents', {})).rejects.toThrow('active');
  });

  it('enforces the shared budget even for simultaneous calls and blocks ancestor loops', async () => {
    const { db, source, earl, mocha, router, tools } = await scope();
    const attempts = await Promise.allSettled(Array.from({ length: 13 }, () => tools.call('cafe_delegate_task', { agentId: mocha.id, message: 'Review' })));
    expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(12);
    expect(attempts.filter((r) => r.status === 'rejected')).toHaveLength(1);
    const child = await db.task.findFirstOrThrow({ where: { sourceTaskId: source.id } });
    await db.task.update({ where: { id: child.id }, data: { status: 'running' } });
    await expect(router.forTask(child.id, new AbortController().signal).call('cafe_delegate_task', { agentId: earl.id, message: 'Back to you' })).rejects.toThrow('ancestor');
  });

  it('blocks depth overflow and archived teammates; messages do not auto-deliver results', async () => {
    const { db, source, mocha, chai, router, tools } = await scope();
    await db.task.update({ where: { id: source.id }, data: { exchangeDepth: 3 } });
    await expect(tools.call('cafe_delegate_task', { agentId: mocha.id, message: 'Review' })).rejects.toThrow('depth');
    await db.task.update({ where: { id: source.id }, data: { exchangeDepth: 0 } });
    await db.agent.update({ where: { id: chai.id }, data: { archivedAt: new Date() } });
    await expect(tools.call('cafe_send_message', { agentId: chai.id, message: 'Hello' })).rejects.toThrow('unavailable');
    const sent = await tools.call('cafe_send_message', { agentId: mocha.id, message: 'FYI' }) as { taskId: string };
    const child = await db.task.update({ where: { id: sent.taskId }, data: { status: 'completed' } });
    await router.deliver(child);
    expect(await db.task.count({ where: { exchangeKind: 'result' } })).toBe(0);
  });

  it('refuses unavailable provider modes and reports teammate availability', async () => {
    const { db, source, mocha, tools } = await scope();
    const agents = await tools.call('cafe_list_agents', {}) as Array<{ id: string; mode: string; busy: boolean }>;
    expect(agents.find((a) => a.id === mocha.id)).toMatchObject({ mode: 'live', busy: false });
    const off = new Collaboration({ db, mode: async () => 'off', log: async () => {}, enqueue: async () => { throw new Error('Must not enqueue'); } });
    await expect(off.forTask(source.id, new AbortController().signal).call('cafe_delegate_task', { agentId: mocha.id, message: 'Review' })).rejects.toThrow('same Live or Demo mode');
  });
});
