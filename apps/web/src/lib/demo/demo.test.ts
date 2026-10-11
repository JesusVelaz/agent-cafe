import type { CafeEvent, TaskDTO } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { emptyData, reduce, threadOf } from '@/store/reduce';
import { DemoCafe } from './cafe';
import { DEMO_NOTE, scriptFor } from './script';
import { seedDemo } from './seed';

const instant = () => Promise.resolve();
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};

function cafe(failRate = 0) {
  const c = new DemoCafe({ sleep: instant, failRate });
  seedDemo(c);
  const events: CafeEvent[] = [];
  c.subscribe((e) => events.push(e));
  const agent = (name: string) => [...c.agents.values()].find((a) => a.name === name)!;
  return { c, events, agent };
}

describe('demo scripts', () => {
  it('end with a labelled answer and use each floor’s own tools', () => {
    const claude = scriptFor('Fix the flaky orders test', 'anthropic');
    const codex = scriptFor('Fix the flaky orders test', 'openai');
    expect(claude.at(-1)!.text).toContain(DEMO_NOTE);
    expect(claude.at(-1)!.tool).toBeUndefined();
    expect(claude.map((s) => s.tool?.name).filter(Boolean)).toEqual(['Grep', 'Read', 'Edit', 'Bash']);
    expect(codex.map((s) => s.tool?.name).filter(Boolean)).toEqual(['shell', 'shell', 'apply_patch', 'shell']);
  });
});

describe('demo café', () => {
  it('starts with agents, projects and finished threads the store can read', () => {
    const { c } = cafe();
    const snap = c.snapshot();
    expect(snap.agents.map((a) => a.name)).toEqual(['Mocha', 'Chai', 'Biscotti', 'Earl', 'Matcha', 'Scone']);
    expect(snap.projects).toHaveLength(2);
    expect(snap.tasks.every((t) => t.status === 'completed' || t.status === 'failed')).toBe(true);

    const state = reduce(emptyData(), snap);
    const earl = snap.agents.find((a) => a.name === 'Earl')!;
    const plan = snap.tasks.find((t) => t.agentId === earl.id && !t.continueOf)!;
    // Earl's thread holds the plan and Mocha's result; Mocha's delegated task has its own.
    expect(threadOf(state, plan.id)!.taskIds).toHaveLength(2);
    expect(snap.tasks.some((t) => t.exchangeKind === 'delegation' && t.sourceTaskId === plan.id)).toBe(true);
    // Every seeded run has a full log, in order.
    for (const t of snap.tasks) {
      const log = c.history(t.id).events;
      expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i));
      expect(log.at(-1)).toMatchObject({ kind: 'status', status: t.status });
    }
  });

  it('runs a task to an answer, streaming text and tool calls', async () => {
    const { c, events, agent } = cafe();
    const task = c.createTask({ agentId: agent('Matcha').id, prompt: 'Write a short README section on running the app.' });
    await settle();
    const done = c.tasks.get(task.id)!;
    expect(done.status).toBe('completed');
    expect(done.output).toContain(DEMO_NOTE);
    expect(done.steps).toBeGreaterThan(1);
    expect(done.costUsd).toBeGreaterThan(0);
    const kinds = events.filter((e) => e.type === 'task.event' && e.taskId === task.id).map((e) => (e as { event: { kind: string } }).event.kind);
    expect(kinds).toContain('model.delta');
    expect(kinds).toContain('tool.start');
  });

  it('stops for Allow / Deny before running a command, and carries on after either', async () => {
    const { c, agent } = cafe();
    const allowed = c.createTask({ agentId: agent('Earl').id, prompt: 'Add tests for the order queue.' });
    const denied = c.createTask({ agentId: agent('Scone').id, prompt: 'Add tests for the order queue.' });
    await settle();
    for (const id of [allowed.id, denied.id]) expect(c.tasks.get(id)!.pendingApproval).not.toBeNull();
    c.answerApproval(allowed.id, c.tasks.get(allowed.id)!.pendingApproval!.id, 'allow');
    c.answerApproval(denied.id, c.tasks.get(denied.id)!.pendingApproval!.id, 'deny');
    await settle();
    expect(c.tasks.get(allowed.id)).toMatchObject({ status: 'completed', pendingApproval: null });
    expect(c.tasks.get(denied.id)!.output).toContain("I didn't run");
  });

  it('queues per agent, continues threads, cancels and retries', async () => {
    const { c, agent } = cafe();
    const matcha = agent('Matcha').id;
    const first = c.createTask({ agentId: matcha, prompt: 'Group the menu board by category.', permission: 'acceptEdits' });
    const second = c.createTask({ agentId: matcha, prompt: 'Find where we still use the legacy register.' });
    expect(c.tasks.get(second.id)!.status).toBe('queued');
    c.cancel(second.id);
    await settle();
    expect(c.tasks.get(first.id)!.status).toBe('completed');
    expect(c.tasks.get(second.id)!.status).toBe('cancelled');

    const retry = c.retry(second.id);
    expect(retry.retryOf).toBe(second.id);
    const follow = c.createTask({ agentId: matcha, prompt: 'Now explain it.', continueTaskId: first.id });
    await settle();
    expect(follow.continueOf).toBe(first.id);
    expect(c.tasks.get(follow.id)!.status).toBe('completed');
  });

  it('renames, pins and deletes threads, delegations included', () => {
    const { c, events, agent } = cafe();
    const earl = agent('Earl').id;
    const result = [...c.tasks.values()].find((t) => t.agentId === earl && t.exchangeKind === 'result')!;
    const root = c.updateThread(result.id, { title: 'Spring board', pinned: false });
    expect(root.continueOf).toBeNull();
    expect(root).toMatchObject({ threadTitle: 'Spring board', threadPinnedAt: null });

    const { removed } = c.deleteThread(result.id);
    expect(removed).toHaveLength(3); // plan, result, and Mocha's delegated task
    expect(removed.some((id) => c.tasks.has(id))).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'task.removed', taskIds: removed });
  });

  it('fails some runs on purpose, and demo traffic keeps half the café free', async () => {
    const { c, agent } = cafe(1);
    const task = c.createTask({ agentId: agent('Chai').id, prompt: 'Check how tax is rounded on large orders.' });
    await settle();
    expect(c.tasks.get(task.id)).toMatchObject({ status: 'failed', failureKind: 'provider_error' });

    const busy: TaskDTO[] = [];
    for (let i = 0; i < 10; i++) {
      const t = c.trafficTick();
      if (t) busy.push(t);
    }
    expect(busy).toHaveLength(3);
  });
});
