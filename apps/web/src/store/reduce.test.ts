import type { CafeEvent, TaskDTO } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { activeTaskFor, agentThreads, emptyData, needsAttention, queuedFor, projectGroups, reduce, threadOf } from './reduce';

const task = (over: Partial<TaskDTO> = {}): TaskDTO => ({
  id: 't1', agentId: 'a1', providerId: 'openai', model: 'gpt-6-sol', prompt: 'hi', status: 'queued',
  isMock: true, maxCostUsd: 0.5, inputTokens: 0, outputTokens: 0, costUsd: null, steps: 0,
  output: null, error: null, failureKind: null, retryOf: null, pendingApproval: null, projectId: null, permission: 'ask', continueOf: null, sessionId: null,
  createdAt: '2026-09-27T10:00:00.000Z', startedAt: null, finishedAt: null, ...over,
});

const ev = (event: object, seq = 0): CafeEvent =>
  ({ type: 'task.event', taskId: 't1', agentId: 'a1', event: { seq, at: '2026-09-27T10:00:01.000Z', ...event } }) as CafeEvent;

describe('reduce', () => {
  it('hydrates from a snapshot', () => {
    const s = reduce(emptyData(), {
      type: 'snapshot',
      agents: [{ id: 'a1', name: 'Mocha', providerId: 'openai', model: 'gpt-6-sol', systemPrompt: '', spriteSeed: 1, projectId: null, permission: 'ask' as const, createdAt: '', archivedAt: null }],
      tasks: [task()],
      lastEvents: {},
      providers: [], projects: [],
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
    const agent = { id: 'a1', name: 'M', providerId: 'openai' as const, model: 'x', systemPrompt: '', spriteSeed: 1, projectId: null, permission: 'ask' as const, createdAt: '', archivedAt: null };
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

  it('puts approvals first, and a quiet task waiting on you is not stuck', () => {
    const approval = { id: 'ap', tool: 'Bash', summary: 'npm test', reason: null, requestedAt: '2026-09-27T11:51:00Z' };
    const waiting = { ...tasks, quiet: { ...tasks.quiet, status: 'tool_wait' as const, pendingApproval: approval } };
    const got = needsAttention({ tasks: waiting, lastActivityAt }, now);
    expect(got.map((a) => `${a.kind}:${a.task.id}`)).toEqual(['approval:quiet', 'failed:fail']);
  });

  it('honours dismissals', () => {
    expect(needsAttention({ tasks, lastActivityAt }, now, new Set(['fail'])).map((a) => a.task.id)).toEqual(['quiet']);
  });
});

/** Every thread on the board, group by group. */
const boardList = (s: Parameters<typeof projectGroups>[0]) => projectGroups(s).flatMap((g) => g.threads);

describe('board threads', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min)).toISOString();
  const done = (over: Partial<TaskDTO>) => task({ status: 'completed', ...over, finishedAt: over.finishedAt ?? over.createdAt ?? at(0) });
  const tasks = (...list: TaskDTO[]) => ({ tasks: Object.fromEntries(list.map((t) => [t.id, t])) });

  it('folds a conversation into one thread titled by its first message, newest activity first', () => {
    const s = tasks(
      done({ id: 'b1', agentId: 'ben', prompt: 'Fix the login bug', createdAt: at(1) }),
      done({ id: 'b2', agentId: 'ben', prompt: 'Now add a test', continueOf: 'b1', createdAt: at(5) }),
      done({ id: 'm1', agentId: 'mocha', prompt: 'Tidy the README', createdAt: at(3) }),
    );
    const threads = boardList(s);
    expect(threads.map((t) => [t.id, t.title, t.messages, t.last.id])).toEqual([
      ['b1', 'Fix the login bug', 2, 'b2'],
      ['m1', 'Tidy the README', 1, 'm1'],
    ]);
  });

  it('tucks delegated work under the thread that asked for it; results are messages in that thread', () => {
    const s = tasks(
      done({ id: 'ask', agentId: 'ben', prompt: 'Ok tell earl and chai to say test', createdAt: at(1) }),
      done({ id: 'earl', agentId: 'earl', prompt: 'Connectivity check from Ben', exchangeKind: 'delegation', sourceTaskId: 'ask', rootTaskId: 'ask', exchange: { senderName: 'Ben', senderProviderId: 'anthropic' }, createdAt: at(2) }),
      task({ id: 'chai', agentId: 'chai', prompt: 'Connectivity check from Ben', status: 'failed', exchangeKind: 'delegation', sourceTaskId: 'ask', rootTaskId: 'ask', exchange: { senderName: 'Ben', senderProviderId: 'anthropic' }, createdAt: at(3), finishedAt: at(4) }),
      done({ id: 'r1', agentId: 'ben', prompt: 'test', exchangeKind: 'result', continueOf: 'ask', sourceTaskId: 'earl', rootTaskId: 'ask', createdAt: at(5) }),
      done({ id: 'r2', agentId: 'ben', prompt: 'gpt-6-luna isn’t available', exchangeKind: 'result', continueOf: 'r1', sourceTaskId: 'chai', rootTaskId: 'ask', createdAt: at(6) }),
    );
    const [ben, ...rest] = boardList(s);
    expect(rest).toEqual([]);
    expect(ben).toMatchObject({ id: 'ask', agentId: 'ben', title: 'Ok tell earl and chai to say test', messages: 3, from: null });
    expect(ben!.children.map((c) => [c.agentId, c.from, c.last.status])).toEqual([
      ['earl', 'Ben', 'completed'],
      ['chai', 'Ben', 'failed'],
    ]);
  });

  it('lists delegated work in the order it was sent, even when it finishes out of order', () => {
    const del = (id: string, sent: number, finished: number) =>
      task({ id, agentId: id, status: 'completed', prompt: id, exchangeKind: 'delegation', sourceTaskId: 'ask', rootTaskId: 'ask', exchange: { senderName: 'Ben', senderProviderId: 'anthropic' }, createdAt: at(sent), finishedAt: at(finished) });
    // 'first' was sent first, but got a follow-up later, so its newest task is the most recent.
    const s = tasks(done({ id: 'ask', agentId: 'ben', prompt: 'ask both', createdAt: at(0) }), del('second', 2, 3), del('first', 1, 4), done({ id: 'first-2', agentId: 'first', prompt: 'again', continueOf: 'first', createdAt: at(8) }));
    expect(boardList(s)[0]!.children.map((c) => c.id)).toEqual(['first', 'second']);
  });

  it('strips the routing line older delegations put in the prompt', () => {
    const s = tasks(done({ id: 'd', agentId: 'chai', exchangeKind: 'delegation', prompt: '[Delegated task from Ben (anthropic), task x]\nSay test', createdAt: at(1) }));
    expect(boardList(s)[0]).toMatchObject({ title: 'Say test', from: 'Ben' });
  });

  it('puts threads at work first (oldest-started on top), then the rest newest first', () => {
    const s = tasks(
      done({ id: 'a1', agentId: 'a', prompt: 'one', createdAt: at(1) }),
      task({ id: 'a2', agentId: 'a', prompt: 'two', continueOf: 'a1', status: 'running', createdAt: at(2) }),
      task({ id: 'q1', agentId: 'q', prompt: 'waiting its turn', status: 'queued', createdAt: at(6) }),
      task({ id: 'b1', agentId: 'b', prompt: 'broke', status: 'failed', createdAt: at(3), finishedAt: at(4) }),
      done({ id: 'c1', agentId: 'c', prompt: 'older', createdAt: at(0) }),
    );
    expect(boardList(s).map((t) => t.id)).toEqual(['a1', 'q1', 'b1', 'c1']);
  });

  it('survives a broken chain (a loop, or a missing earlier task)', () => {
    const s = tasks(
      done({ id: 'x', agentId: 'a', prompt: 'x', continueOf: 'y', createdAt: at(1) }),
      done({ id: 'y', agentId: 'a', prompt: 'y', continueOf: 'x', createdAt: at(2) }),
      done({ id: 'z', agentId: 'b', prompt: 'z', continueOf: 'gone', createdAt: at(3) }),
    );
    const threads = boardList(s);
    expect(threads.map((t) => t.title).sort()).toEqual(['x', 'z']);
  });
});

describe('agentThreads / threadOf', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min)).toISOString();
  const tasks = (...list: TaskDTO[]) => ({ tasks: Object.fromEntries(list.map((t) => [t.id, t])) });

  it('lists every thread an agent has, running ones included, newest activity first', () => {
    const s = tasks(
      task({ id: 'old', agentId: 'ben', prompt: 'Old work', status: 'completed', createdAt: at(1), finishedAt: at(2) }),
      task({ id: 'now', agentId: 'ben', prompt: 'Fix the login bug', status: 'running', createdAt: at(5) }),
      task({ id: 'help', agentId: 'ben', prompt: 'Help Earl', status: 'completed', exchangeKind: 'delegation', sourceTaskId: 'e1', exchange: { senderName: 'Earl', senderProviderId: 'anthropic' }, createdAt: at(3), finishedAt: at(4) }),
      task({ id: 'e1', agentId: 'earl', prompt: 'Earl’s own', status: 'completed', createdAt: at(0), finishedAt: at(1) }),
    );
    expect(agentThreads(s, 'ben').map((t) => [t.id, t.title, t.from])).toEqual([
      ['now', 'Fix the login bug', null],
      ['help', 'Help Earl', 'Earl'],
      ['old', 'Old work', null],
    ]);
  });

  it('finds the thread any message belongs to, with its messages in order', () => {
    const s = tasks(
      task({ id: 'a', agentId: 'ben', prompt: 'first', status: 'completed', createdAt: at(1), finishedAt: at(2) }),
      task({ id: 'b', agentId: 'ben', prompt: 'second', status: 'completed', continueOf: 'a', createdAt: at(3), finishedAt: at(4) }),
    );
    expect(threadOf(s, 'b')).toMatchObject({ id: 'a', taskIds: ['a', 'b'], messages: 2 });
    expect(threadOf(s, 'missing')).toBeUndefined();
  });

  it('keeps a retry in the thread of the message it retried, even the first one', () => {
    const s = tasks(
      task({ id: 'a', agentId: 'ben', prompt: 'first', status: 'failed', createdAt: at(1), finishedAt: at(2) }),
      task({ id: 'a2', agentId: 'ben', prompt: 'first', status: 'completed', retryOf: 'a', createdAt: at(3), finishedAt: at(4) }),
    );
    expect(agentThreads(s, 'ben').map((t) => [t.id, t.taskIds, t.last.id])).toEqual([['a', ['a', 'a2'], 'a2']]);
  });
});

describe('projectGroups', () => {
  const at = (min: number) => new Date(Date.UTC(2026, 9, 1, 10, min)).toISOString();
  const tasks = (...list: TaskDTO[]) => ({ tasks: Object.fromEntries(list.map((t) => [t.id, t])) });
  const done = (id: string, projectId: string | null, min: number, over: Partial<TaskDTO> = {}) =>
    task({ id, agentId: 'ben', prompt: id, projectId, status: 'completed', createdAt: at(min), finishedAt: at(min), ...over });

  it('groups threads by project: working projects first, then by latest activity, Demo last', () => {
    const s = tasks(
      done('demo1', null, 50),
      done('shop1', 'shop', 40),
      done('cafe1', 'cafe', 10),
      task({ id: 'cafe2', agentId: 'ben', prompt: 'cafe2', projectId: 'cafe', status: 'running', createdAt: at(20) }),
      done('docs1', 'docs', 30),
    );
    const groups = projectGroups(s);
    expect(groups.map((g) => [g.projectId, g.working, g.threads.map((t) => t.id)])).toEqual([
      ['cafe', 1, ['cafe2', 'cafe1']],
      ['shop', 0, ['shop1']],
      ['docs', 0, ['docs1']],
      [null, 0, ['demo1']],
    ]);
  });

  it('keeps delegated work under its thread, not as its own entry in the project', () => {
    const s = tasks(
      done('ask', 'cafe', 1),
      done('helped', 'cafe', 2, { agentId: 'earl', exchangeKind: 'delegation', sourceTaskId: 'ask', exchange: { senderName: 'Ben', senderProviderId: 'anthropic' } }),
    );
    const [cafe] = projectGroups(s);
    expect(cafe!.threads.map((t) => [t.id, t.children.map((c) => c.id)])).toEqual([['ask', ['helped']]]);
  });

  it('counts nested delegated work and keeps its project active after the coordinator finishes', () => {
    const s = tasks(
      done('ask', 'cafe', 1),
      done('child', 'cafe', 2, { agentId: 'earl', exchangeKind: 'delegation', sourceTaskId: 'ask', exchange: { senderName: 'Ben', senderProviderId: 'anthropic' } }),
      task({ id: 'nested', agentId: 'chai', projectId: 'cafe', status: 'running', createdAt: at(3), exchangeKind: 'delegation', sourceTaskId: 'child', exchange: { senderName: 'Earl', senderProviderId: 'anthropic' } }),
      task({ id: 'parallel', agentId: 'mocha', projectId: 'cafe', status: 'queued', createdAt: at(4), exchangeKind: 'delegation', sourceTaskId: 'ask', exchange: { senderName: 'Ben', senderProviderId: 'anthropic' } }),
      done('recent', 'cafe', 10),
      done('other', 'shop', 20),
    );
    const [cafe, shop] = projectGroups(s);
    expect(cafe).toMatchObject({ projectId: 'cafe', working: 2 });
    expect(cafe!.threads.map((th) => th.id)).toEqual(['ask', 'recent']);
    expect(shop!.projectId).toBe('shop');
    expect(threadOf(s, 'ask')!.at).toBe(at(4));
  });

  it('uses delegated completion time when sorting quiet projects', () => {
    const s = tasks(
      done('ask', 'cafe', 1),
      done('child', 'cafe', 20, { agentId: 'earl', exchangeKind: 'delegation', sourceTaskId: 'ask', exchange: { senderName: 'Ben', senderProviderId: 'anthropic' } }),
      done('other', 'shop', 10),
    );
    expect(projectGroups(s).map((g) => [g.projectId, g.working])).toEqual([['cafe', 0], ['shop', 0]]);
  });
});
