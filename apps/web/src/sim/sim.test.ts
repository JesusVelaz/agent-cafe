import type { TaskDTO, TaskEventDTO } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { deriveActivity } from './activity';
import { FLOORS, cellOf, isBlockedCell } from './layout';
import { Cats } from './cats';
import { findPath } from './pathfinding';

const task = (over: Partial<TaskDTO> = {}): TaskDTO => ({
  id: 't', agentId: 'a', providerId: 'openai', model: 'm', prompt: 'p', status: 'running', isMock: true,
  maxCostUsd: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0, output: null, error: null,
  failureKind: null, retryOf: null, pendingApproval: null, projectId: null, permission: 'ask', continueOf: null, sessionId: null, createdAt: '2026-09-27T10:00:00Z',
  startedAt: '2026-09-27T10:00:00Z', finishedAt: null, ...over,
});
const T0 = Date.parse('2026-09-27T10:00:00Z');

describe('layout', () => {
  it.each(Object.values(FLOORS))('every station and seat on $id is reachable from every seat', (floor) => {
    const spots = [...Object.values(floor.stations).flat(), ...floor.seats, floor.entrance];
    for (const from of floor.seats) {
      for (const to of spots) expect(findPath(floor, from, to), JSON.stringify([floor.id, from, to])).not.toBeNull();
    }
  });
  it.each(Object.values(FLOORS))('stations on $id stand on free cells', (floor) => {
    for (const spot of Object.values(floor.stations).flat()) {
      const c = cellOf(spot);
      expect(isBlockedCell(floor, c.i, c.j), JSON.stringify([floor.id, spot])).toBe(false);
    }
  });
});

describe('findPath', () => {
  const floor = FLOORS.openai;
  it('walks around the counter and ends exactly on the target', () => {
    const path = findPath(floor, { x: 9.0, y: 4.0 }, { x: 13.0, y: 3.6 })!;
    expect(path.at(-1)).toEqual({ x: 13.0, y: 3.6 });
    for (const p of path.slice(0, -1)) { const c = cellOf(p); expect(isBlockedCell(floor, c.i, c.j)).toBe(false); }
  });
  it('returns [] when already there', () => {
    expect(findPath(floor, { x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });
});

describe('deriveActivity', () => {
  const ev = (e: object): TaskEventDTO => ({ seq: 1, at: '2026-09-27T10:00:01Z', ...e }) as TaskEventDTO;

  it('maps tool calls to the tool', () => {
    const a = deriveActivity({
      activeTask: task(), latestTask: task(), lastActivityAt: T0 + 1000, now: T0 + 2000,
      lastEvent: ev({ kind: 'tool.start', step: 1, callId: 'c', tool: 'read_file', input: {} }),
    });
    expect(a).toEqual({ kind: 'tool', tool: 'read_file' });
  });

  it('flags quiet running tasks as stuck', () => {
    const a = deriveActivity({
      activeTask: task(), latestTask: task(), lastActivityAt: T0, now: T0 + 61_000,
      lastEvent: ev({ kind: 'model.start', step: 1, maxOutputTokens: 1 }),
    });
    expect(a.kind).toBe('stuck');
  });

  it('keeps a silent live model thinking rather than stuck', () => {
    const live = task({ isMock: false });
    expect(deriveActivity({
      activeTask: live, latestTask: live, lastActivityAt: T0, now: T0 + 600_000,
      lastEvent: ev({ kind: 'model.start', step: 2, maxOutputTokens: 1 }),
    })).toEqual({ kind: 'thinking', step: 2 });
  });

  it('keeps a long live command at work but still shows an approval when requested', () => {
    const live = task({ isMock: false, status: 'tool_wait' });
    const input = {
      activeTask: live, latestTask: live, lastActivityAt: T0, now: T0 + 600_000,
      lastEvent: ev({ kind: 'tool.start', step: 1, callId: 'c', tool: 'Bash', input: {} }),
    };
    expect(deriveActivity(input)).toEqual({ kind: 'tool', tool: 'Bash' });
    expect(deriveActivity({ ...input, activeTask: { ...live, pendingApproval: {
      id: 'ap', tool: 'Bash', summary: 'npm test', reason: null, rememberable: true, requestedAt: '2026-09-27T10:00:01Z',
    } } })).toEqual({ kind: 'approval', tool: 'Bash' });
  });

  it('shows done/failed briefly after finishing, then idle', () => {
    const done = task({ status: 'completed', finishedAt: '2026-09-27T10:00:10Z' });
    const base = { activeTask: undefined, latestTask: done, lastEvent: undefined, lastActivityAt: undefined };
    expect(deriveActivity({ ...base, now: T0 + 12_000 }).kind).toBe('done');
    expect(deriveActivity({ ...base, now: T0 + 30_000 }).kind).toBe('idle');
    const failed = task({ status: 'failed', finishedAt: '2026-09-27T10:00:10Z' });
    expect(deriveActivity({ ...base, latestTask: failed, now: T0 + 12_000 }).kind).toBe('failed');
  });
});

describe('World', () => {
  it('walks an agent to the tool station and back home', async () => {
    const { World } = await import('./world');
    const { emptyData, reduce } = await import('@/store/reduce');
    const agent = { id: 'a', name: 'Mocha', providerId: 'openai' as const, model: 'm', systemPrompt: '', spriteSeed: 1, projectId: null, permission: 'ask' as const, createdAt: '2026-01-01T00:00:00Z', archivedAt: null };
    let data = reduce(emptyData(), { type: 'snapshot', agents: [agent], tasks: [], lastEvents: {}, providers: [], projects: [] });
    const world = new World();
    const now = T0;
    world.update(0.016, data, now);
    const home = { x: world.agents[0]!.x, y: world.agents[0]!.y };

    data = reduce(data, { type: 'task.upserted', task: task({ agentId: 'a' }) }, now);
    world.update(0.016, data, now); // first sight of the task
    data = reduce(data, { type: 'task.event', taskId: 't', agentId: 'a', event: { kind: 'tool.start', step: 1, callId: 'c', tool: 'read_file', input: {}, seq: 1, at: '2026-09-27T10:00:01Z' } }, now);
    for (let i = 0; i < 120; i++) world.update(0.05, data, now + i * 50);
    const at = world.agents[0]!;
    expect([at.x, at.y]).toEqual([1.0, 6.9]); // bookcase spot
    expect(at.pose).toBe('work');

    data = reduce(data, { type: 'task.event', taskId: 't', agentId: 'a', event: { kind: 'tool.end', step: 1, callId: 'c', tool: 'read_file', ok: true, output: '', seq: 2, at: '2026-09-27T10:00:02Z' } }, now);
    for (let i = 0; i < 200; i++) world.update(0.05, data, now + 6000 + i * 50);
    expect({ x: world.agents[0]!.x, y: world.agents[0]!.y }).toEqual(home);
  });
});

describe('cats', () => {
  it.each(Object.values(FLOORS))('cat spots on $id are free and reachable from the entrance', (floor) => {
    for (const spot of floor.catSpots) {
      const c = cellOf(spot);
      expect(isBlockedCell(floor, c.i, c.j), JSON.stringify([floor.id, spot])).toBe(false);
      expect(findPath(floor, floor.entrance, spot), JSON.stringify([floor.id, spot])).not.toBeNull();
    }
  });

  it('roam for ten minutes without walking through furniture', () => {
    const cats = new Cats();
    const moved = new Set<string>();
    const start = new Map(cats.views.map((v) => [v.id, `${v.x},${v.y}`]));
    for (let i = 0; i < 6000; i++) {
      cats.update(0.1);
      for (const v of cats.views) {
        const c = cellOf(v);
        const onSpot = FLOORS[v.floor].catSpots.some((s) => Math.hypot(s.x - v.x, s.y - v.y) < 0.01);
        if (!onSpot) expect(isBlockedCell(FLOORS[v.floor], c.i, c.j), JSON.stringify(v)).toBe(false);
        if (`${v.x},${v.y}` !== start.get(v.id)) moved.add(v.id);
      }
    }
    expect(moved.size).toBe(cats.views.length);
  });

  it('sit up and stay a while when petted, unless asleep', () => {
    const cats = new Cats();
    // Run until one cat is awake and settled, and another is asleep.
    const find = (want: (pose: string) => boolean) => cats.views.find((v) => want(v.pose));
    for (let i = 0; i < 6000 && !(find((p) => p === 'sit' || p === 'loaf') && find((p) => p === 'sleep')); i++) cats.update(0.1);
    const awake = find((p) => p === 'sit' || p === 'loaf')!, asleep = find((p) => p === 'sleep')!;
    expect(awake).toBeDefined();
    expect(asleep).toBeDefined();

    const at = { x: awake.x, y: awake.y };
    cats.pet(awake.id);
    cats.pet(asleep.id);
    expect(awake.pose).toBe('sit');
    expect(asleep.pose).toBe('sleep');
    for (let i = 0; i < 55; i++) cats.update(0.1);
    expect({ x: awake.x, y: awake.y }).toEqual(at);
    cats.pet('nobody'); // unknown cats are ignored
  });
});
