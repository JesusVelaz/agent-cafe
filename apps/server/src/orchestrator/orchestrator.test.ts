import type { CafeEvent } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db/client.js';
import { EventBus } from '../events/bus.js';
import { ProviderConfigService } from '../providers/config.js';
import { sleep, type ProviderAdapter } from '../providers/types.js';
import { SettingsService } from '../settings.js';
import { testDb } from '../test/testDb.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ClaudeRunContext } from '../providers/claude.js';
import type { HarnessState } from '@agent-cafe/shared';
import { fakeHarnesses } from '../test/fakeHarness.js';
import { Orchestrator } from './orchestrator.js';
import type { RunOutcome } from './runner.js';

const tools: ToolRegistry = { specs: [], execute: async () => ({ ok: true, output: 'ok' }) };

/** Adapter whose turns wait on a gate, recording prompts in call order. */
function gatedAdapter(kind: 'mock' | 'live' = 'mock') {
  const prompts: string[] = [];
  let open!: () => void;
  let gate = new Promise<void>((r) => (open = r));
  const adapter: ProviderAdapter = {
    kind,
    testConnection: async () => ({ ok: true, message: '' }),
    async runTurn(req, signal, onDelta) {
      const m = req.messages[0];
      prompts.push(m?.role === 'user' ? m.content : '');
      await Promise.race([gate, sleep(10_000, signal)]);
      onDelta('done');
      return { text: 'done', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stop: 'end' };
    },
  };
  return {
    adapter,
    prompts,
    release: () => open(),
    closeAgain: () => (gate = new Promise<void>((r) => (open = r))),
  };
}

async function setup(
  opts: { adapter?: ProviderAdapter; harness?: HarnessState; runClaude?: (ctx: ClaudeRunContext) => Promise<RunOutcome> } = {},
) {
  const db = await testDb({ seed: true });
  const bus = new EventBus();
  const events: CafeEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const providers = new ProviderConfigService(db, fakeHarnesses(opts.harness));
  const gated = gatedAdapter();
  const adapter = opts.adapter ?? gated.adapter;
  const orch = new Orchestrator({
    db,
    bus,
    providers,
    settings: new SettingsService(db),
    tools,
    resolveAdapter: async () => adapter,
    ...(opts.runClaude ? { runClaude: opts.runClaude } : {}),
  });
  const agent = (name: string) => db.agent.findFirstOrThrow({ where: { name } });
  return { db, bus, events, providers, orch, gated, agent };
}

async function waitFor(fn: () => Promise<boolean> | boolean, ms = 3000) {
  const start = Date.now();
  while (!(await fn())) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await sleep(5);
  }
}

const statusOf = async (db: Db, id: string) => (await db.task.findUniqueOrThrow({ where: { id } })).status;

describe('Orchestrator', () => {
  it('runs one agent’s tasks in FIFO order', async () => {
    const { orch, gated, agent, db } = await setup();
    const mocha = await agent('Mocha');
    const ids = [];
    for (const p of ['first', 'second', 'third']) {
      ids.push((await orch.enqueue({ prompt: p, target: { agentId: mocha.id } })).id);
    }
    gated.release();
    await orch.idle();
    expect(gated.prompts).toEqual(['first', 'second', 'third']);
    for (const id of ids) expect(await statusOf(db, id)).toBe('completed');
  });

  it('runs different agents concurrently', async () => {
    const { orch, gated, agent, db } = await setup();
    const a = await orch.enqueue({ prompt: 'a', target: { agentId: (await agent('Mocha')).id } });
    const b = await orch.enqueue({ prompt: 'b', target: { agentId: (await agent('Earl')).id } });
    await waitFor(async () => (await statusOf(db, a.id)) === 'running' && (await statusOf(db, b.id)) === 'running');
    gated.release();
    await orch.idle();
  });

  it('routes "any idle" to a free agent on that floor', async () => {
    const { orch, gated, agent, db } = await setup();
    const mocha = await agent('Mocha');
    await orch.enqueue({ prompt: 'busy', target: { agentId: mocha.id } });
    await waitFor(() => orch.isBusy(mocha.id));
    const routed = await orch.enqueue({ prompt: 'anyone', target: { providerId: 'openai' } });
    expect(routed.agentId).not.toBe(mocha.id);
    expect(routed.providerId).toBe('openai');
    const byModel = await orch.enqueue({ prompt: 'astra', target: { providerId: 'openai', model: 'gpt-6-astra' } });
    expect(byModel.agentId).toBe((await agent('Biscotti')).id);
    await expect(orch.enqueue({ prompt: 'x', target: { providerId: 'openai', model: 'nope' } })).rejects.toThrow(/No openai agent/);
    gated.release();
    await orch.idle();
    expect(await statusOf(db, routed.id)).toBe('completed');
  });

  it('never runs a task cancelled while queued, and cancels running ones', async () => {
    const { orch, gated, agent, db } = await setup();
    const mocha = await agent('Mocha');
    const running = await orch.enqueue({ prompt: 'running', target: { agentId: mocha.id } });
    const queued = await orch.enqueue({ prompt: 'queued', target: { agentId: mocha.id } });
    await waitFor(async () => (await statusOf(db, running.id)) === 'running');
    await orch.cancel(queued.id);
    await orch.cancel(running.id);
    await orch.idle();
    expect(await statusOf(db, running.id)).toBe('cancelled');
    expect(await statusOf(db, queued.id)).toBe('cancelled');
    expect(gated.prompts).toEqual(['running']);
  });

  it('marks mid-run tasks interrupted on recovery and resumes the queue', async () => {
    const { orch, gated, agent, db } = await setup();
    const mocha = await agent('Mocha');
    const base = { agentId: mocha.id, providerId: 'openai', model: mocha.model, maxCostUsd: 0.5, isMock: true };
    const stale = await db.task.create({ data: { ...base, prompt: 'stale', status: 'running', startedAt: new Date() } });
    const waiting = await db.task.create({ data: { ...base, prompt: 'waiting', status: 'queued' } });
    gated.release();
    await orch.recover();
    await orch.idle();
    const s = await db.task.findUniqueOrThrow({ where: { id: stale.id } });
    expect(s.status).toBe('interrupted');
    expect(s.error).toMatch(/Retry/);
    expect(await statusOf(db, waiting.id)).toBe('completed');
    expect(gated.prompts).toEqual(['waiting']);
  });

  it('retries a finished task as a new linked task', async () => {
    const { orch, gated, agent } = await setup();
    const t = await orch.enqueue({ prompt: 'again', target: { agentId: (await agent('Earl')).id }, maxCostUsd: 0.2 });
    gated.release();
    await orch.idle();
    const r = await orch.retry(t.id);
    expect(r).toMatchObject({ retryOf: t.id, prompt: 'again', maxCostUsd: 0.2, status: 'queued' });
    await orch.idle();
  });

  it('refuses tasks for a provider that is off', async () => {
    const { orch, providers, agent } = await setup();
    await providers.update('anthropic', { mode: 'off' });
    await expect(orch.enqueue({ prompt: 'x', target: { agentId: (await agent('Earl')).id } })).rejects.toThrow(/switched off/);
  });

  it('runs live Anthropic tasks on Claude Code and waits for approvals', async () => {
    const seen: ClaudeRunContext[] = [];
    const runClaude = async (ctx: ClaudeRunContext): Promise<RunOutcome> => {
      seen.push(ctx);
      ctx.emit({ kind: 'tool.start', step: 1, callId: 'c1', tool: 'Bash', input: { command: 'ls' } });
      const d = await ctx.approve({ tool: 'Bash', summary: 'ls', reason: null }, ctx.signal);
      ctx.emit({ kind: 'tool.end', step: 1, callId: 'c1', tool: 'Bash', ok: d === 'allow', output: '' });
      return { status: 'completed', output: d, totals: { inputTokens: 3, outputTokens: 4, costUsd: null, steps: 1 } };
    };
    const { orch, providers, agent, db } = await setup({ runClaude });
    const earl = await agent('Earl');
    const project = await db.project.create({ data: { name: 'app', path: '/tmp/project' } });
    await providers.update('anthropic', { mode: 'live' });
    const t = await orch.enqueue({ prompt: 'list files', target: { agentId: earl.id }, projectId: project.id, permission: 'acceptEdits', model: 'claude-sonnet-5' });
    await waitFor(async () => Boolean((await db.task.findUniqueOrThrow({ where: { id: t.id } })).pendingApproval));
    const pending = JSON.parse((await db.task.findUniqueOrThrow({ where: { id: t.id } })).pendingApproval!);
    expect(pending).toMatchObject({ tool: 'Bash', summary: 'ls' });
    await orch.resolveApproval(t.id, pending.id, 'allow');
    await orch.idle();
    const done = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(done).toMatchObject({ status: 'completed', output: 'allow', isMock: false, pendingApproval: null });
    expect(seen[0]!.agent).toMatchObject({ workDir: '/tmp/project', permission: 'acceptEdits' });
    expect(seen[0]!.task.model).toBe('claude-sonnet-5');
    // The agent remembers the last choices as the composer's defaults.
    expect(await db.agent.findUniqueOrThrow({ where: { id: earl.id } })).toMatchObject({
      model: 'claude-sonnet-5', permission: 'acceptEdits', projectId: project.id,
    });
    await expect(orch.resolveApproval(t.id, pending.id, 'deny')).rejects.toThrow(/already answered/);
    const kinds = (await db.taskEvent.findMany({ where: { taskId: t.id } })).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['approval.request', 'approval.resolved']));
  });

  it('denies a pending approval when the task is cancelled', async () => {
    const runClaude = async (ctx: ClaudeRunContext): Promise<RunOutcome> => {
      const d = await ctx.approve({ tool: 'Edit', summary: 'a.ts', reason: null }, ctx.signal);
      return { status: 'failed', failureKind: 'provider_error', error: d, totals: { inputTokens: 0, outputTokens: 0, costUsd: null, steps: 0 } };
    };
    const { orch, providers, agent, db } = await setup({ runClaude });
    const earl = await agent('Earl');
    const project = await db.project.create({ data: { name: 'app', path: '/tmp/project' } });
    await providers.update('anthropic', { mode: 'live' });
    const t = await orch.enqueue({ prompt: 'edit', target: { agentId: earl.id }, projectId: project.id });
    await waitFor(async () => Boolean((await db.task.findUniqueOrThrow({ where: { id: t.id } })).pendingApproval));
    await orch.cancel(t.id);
    await orch.idle();
    // The run loop saw a deny; the orchestrator still records the user's cancel.
    expect(await db.task.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ pendingApproval: null });
  });

  it('continues a conversation by resuming the earlier task’s session', async () => {
    const seen: ClaudeRunContext[] = [];
    const runClaude = async (ctx: ClaudeRunContext): Promise<RunOutcome> => {
      seen.push(ctx);
      ctx.onSession?.(`sess-${seen.length}`);
      return { status: 'completed', output: 'ok', totals: { inputTokens: 1, outputTokens: 1, costUsd: null, steps: 1 } };
    };
    const { orch, providers, agent, db } = await setup({ runClaude });
    const earl = await agent('Earl');
    const project = await db.project.create({ data: { name: 'app', path: '/tmp/project' } });
    const other = await db.project.create({ data: { name: 'site', path: '/tmp/site' } });
    await providers.update('anthropic', { mode: 'live' });
    const first = await orch.enqueue({ prompt: 'one', target: { agentId: earl.id }, projectId: project.id });
    await orch.idle();
    expect((await db.task.findUniqueOrThrow({ where: { id: first.id } })).sessionId).toBe('sess-1');
    const second = await orch.enqueue({ prompt: 'two', target: { agentId: earl.id }, continueTaskId: first.id });
    await orch.idle();
    expect(second).toMatchObject({ continueOf: first.id, projectId: project.id });
    expect(seen[1]!.resume).toBe('sess-1');
    await expect(orch.enqueue({ prompt: 'x', target: { agentId: earl.id }, projectId: other.id, continueTaskId: first.id })).rejects.toThrow(/same project/);
    const matcha = await agent('Matcha');
    await expect(orch.enqueue({ prompt: 'x', target: { agentId: matcha.id }, continueTaskId: first.id })).rejects.toThrow(/another agent/);
  });

  it('refuses live tasks until Claude Code is signed in and a project is picked', async () => {
    const signedOut = await setup({ harness: 'signed_out' });
    await expect(signedOut.providers.update('anthropic', { mode: 'live' })).rejects.toThrow(/claude auth login/);

    const ready = await setup();
    await ready.providers.update('anthropic', { mode: 'live' });
    await expect(ready.orch.enqueue({ prompt: 'x', target: { agentId: (await ready.agent('Earl')).id } })).rejects.toThrow(/project/);
    await expect(ready.orch.enqueue({ prompt: 'x', target: { agentId: (await ready.agent('Earl')).id }, projectId: 'nope' })).rejects.toThrow(/no longer exists/);
    // Codex isn't wired yet: the ground floor can't go live.
    await expect(ready.providers.update('openai', { mode: 'live' })).rejects.toThrow(/coming next/);
  });

  it('persists ordered events, streams deltas without persisting them, and tracks usage', async () => {
    const { orch, gated, agent, db, events } = await setup();
    gated.release();
    const t = await orch.enqueue({ prompt: 'hello', target: { agentId: (await agent('Matcha')).id } });
    await orch.idle();
    const rows = await db.taskEvent.findMany({ where: { taskId: t.id }, orderBy: { seq: 'asc' } });
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => i));
    expect(rows.map((r) => r.kind)).toEqual(['status', 'status', 'model.start', 'model.end', 'status']);
    expect(rows.some((r) => r.kind === 'model.delta')).toBe(false);
    const deltas = events.filter((e) => e.type === 'task.event' && e.event.kind === 'model.delta');
    expect(deltas.length).toBeGreaterThan(0);
    const done = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(done).toMatchObject({ status: 'completed', output: 'done', inputTokens: 10, outputTokens: 5, steps: 1 });
    expect(done.costUsd).toBeGreaterThan(0);
  });

  it('builds a snapshot with agents, tasks, providers and settings', async () => {
    const { orch, gated, agent } = await setup();
    const t = await orch.enqueue({ prompt: 'snap', target: { agentId: (await agent('Chai')).id } });
    await sleep(30);
    const snap = await orch.snapshot();
    expect(snap.agents).toHaveLength(6);
    expect(snap.tasks.map((x) => x.id)).toContain(t.id);
    expect(snap.providers).toHaveLength(2);
    expect(snap.settings).toEqual({ ambient: true });
    expect(snap.lastEvents[t.id]).toBeDefined();
    gated.release();
    await orch.idle();
  });
});
