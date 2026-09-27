import type { CafeEvent, TaskDTO } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { activeTaskFor, emptyData, needsAttention, queuedFor, reduce } from './reduce';

const task = (over: Partial<TaskDTO> = {}): TaskDTO => ({
  id: 't1', agentId: 'a1', providerId: 'openai', model: 'gpt-6-sol', prompt: 'hi', status: 'queued',
  isMock: true, maxCostUsd: 0.5, inputTokens: 0, outputTokens: 0, costUsd: null, steps: 0,
  output: null, error: null, failureKind: null, retryOf: null,
  createdAt: '2026-09-27T10:00:00.000Z', startedAt: null, finishedAt: null, ...over,
});

const ev = (event: object, seq = 0): CafeEvent =>
  ({ type: 'task.event', taskId: 't1', agentId: 'a1', event: { seq, at: '2026-09-27T10:00:01.000Z', ...event } }) as CafeEvent;

describe('reduce', () => {
  it('hydrates from a snapshot', () => {
    const s = reduce(emptyData(), {
      type: 'snapshot',
      agents: [{ id: 'a1', name: 'Mocha', providerId: 'openai', model: 'gpt-6-sol', systemPrompt: '', spriteSeed: 1, createdAt: '', archivedAt: null }],
      tasks: [task()],
      lastEvents: {},
      providers: [],
      settings: { ambient: true },
    });
    expect(s.hydrated).toBe(true);
    expect(Object.keys(s.agents)).toEqual(['a1']);
    expect(queuedFor(s, 'a1')).toHaveLength(1);
  });

  it('merges task upserts', () => {
    let s = reduce(emptyData(), { type: 'task.upserted', task: task() });
    s = reduce(s, { type: 'task.upserted', task: task({ status: 'running' }) });
    expect(activeTaskFor(s, 'a1')?.status).toBe('running');
  });

  it('streams deltas without logging them, and resets per step', () => {
    let s = reduce(emptyData(), ev({ kind: 'model.start', step: 1, maxOutputTokens: 100 }));
    s = reduce(s, ev({ kind: 'model.delta', step: 1, text: 'Hel' }, -1), 5000);
    s = reduce(s, ev({ kind: 'model.delta', step: 1, text: 'lo' }, -1), 6000);
    expect(s.streamText.t1).toBe('Hello');
    expect(s.events.t1).toHaveLength(1);
    expect(s.lastEvent.t1?.kind).toBe('model.start');
    expect(s.lastActivityAt.t1).toBe(6000);
    s = reduce(s, ev({ kind: 'model.start', step: 2, maxOutputTokens: 100 }, 1));
    expect(s.streamText.t1).toBe('');
  });

  it('drops archived agents', () => {
    const agent = { id: 'a1', name: 'M', providerId: 'openai' as const, model: 'x', systemPrompt: '', spriteSeed: 1, createdAt: '', archivedAt: null };
    let s = reduce(emptyData(), { type: 'agent.upserted', agent });
    s = reduce(s, { type: 'agent.upserted', agent: { ...agent, archivedAt: '2026-09-27T00:00:00Z' } });
    expect(s.agents).toEqual({});
  });
});

describe('needsAttention', () => {
  const now = Date.parse('2026-09-27T12:00:00Z');
  const tasks = {
    run: task({ id: 'run', status: 'running', startedAt: '2026-09-27T11:58:00Z' }),
    quiet: task({ id: 'quiet', agentId: 'a2', status: 'running', startedAt: '2026-09-27T11:50:00Z' }),
    fail: task({ id: 'fail', status: 'failed', finishedAt: '2026-09-27T11:55:00Z' }),
    old: task({ id: 'old', status: 'failed', finishedAt: '2026-09-27T09:00:00Z' }),
    retried: task({ id: 'retried', agentId: 'a4', status: 'interrupted', finishedAt: '2026-09-27T11:59:00Z' }),
    retry: task({ id: 'retry', agentId: 'a4', status: 'queued', retryOf: 'retried' }),
    recovered: task({ id: 'recovered', agentId: 'a3', status: 'failed', finishedAt: '2026-09-27T11:40:00Z' }),
    later: task({ id: 'later', agentId: 'a3', status: 'completed', finishedAt: '2026-09-27T11:45:00Z' }),
  };
  const lastActivityAt = { run: now - 5_000, quiet: now - 120_000 };

  it('lists stuck runs first, then fresh un-retried failures the agent has not recovered from', () => {
    const got = needsAttention({ tasks, lastActivityAt }, now);
    expect(got.map((a) => `${a.kind}:${a.task.id}`)).toEqual(['stuck:quiet', 'failed:fail']);
  });

  it('honours dismissals', () => {
    expect(needsAttention({ tasks, lastActivityAt }, now, new Set(['fail'])).map((a) => a.task.id)).toEqual(['quiet']);
  });
});
