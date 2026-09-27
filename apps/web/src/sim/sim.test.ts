import type { TaskDTO, TaskEventDTO } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { deriveActivity } from './activity';
import { FLOORS, FLOOR_D, FLOOR_W, isBlocked } from './layout';
import { findPath } from './pathfinding';

const task = (over: Partial<TaskDTO> = {}): TaskDTO => ({
  id: 't', agentId: 'a', providerId: 'openai', model: 'm', prompt: 'p', status: 'running', isMock: true,
  maxCostUsd: 1, inputTokens: 0, outputTokens: 0, costUsd: 0, steps: 0, output: null, error: null,
  failureKind: null, retryOf: null, createdAt: '2026-09-27T10:00:00Z',
  startedAt: '2026-09-27T10:00:00Z', finishedAt: null, ...over,
});
const T0 = Date.parse('2026-09-27T10:00:00Z');

describe('layout', () => {
  it.each(Object.values(FLOORS))('every station, seat and cup slot on $id is sane', (floor) => {
    const spots = [...Object.values(floor.stations).flat(), ...floor.homeSeats];
    for (const spot of spots) {
      expect(isBlocked(floor, spot.x, spot.y), `${floor.id} ${spot.x},${spot.y}`).toBe(false);
    }
    // Every spot is reachable from every home seat.
    for (const spot of spots) expect(findPath(floor, floor.homeSeats[0]!, spot)).not.toBeNull();
    for (const c of floor.cupSlots) expect(c.x < FLOOR_W && c.y < FLOOR_D).toBe(true);
  });
});

describe('findPath', () => {
  const floor = FLOORS.openai;
  it('walks around the counter', () => {
    const path = findPath(floor, { x: 3, y: 3 }, { x: 11, y: 3 })!;
    expect(path.at(-1)).toEqual({ x: 11, y: 3 });
    expect(path.every((t) => !isBlocked(floor, t.x, t.y))).toBe(true);
    expect(path).toHaveLength(8);
  });
  it('returns [] when already there and null for blocked goals', () => {
    expect(findPath(floor, { x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
    expect(findPath(floor, { x: 3, y: 3 }, { x: 6, y: 2 })).toBeNull();
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
    const agent = { id: 'a', name: 'Mocha', providerId: 'openai' as const, model: 'm', systemPrompt: '', spriteSeed: 1, createdAt: '2026-01-01T00:00:00Z', archivedAt: null };
    let data = reduce(emptyData(), { type: 'snapshot', agents: [agent], tasks: [], lastEvents: {}, providers: [], settings: { ambient: false } });
    const world = new World();
    const now = T0;
    world.update(0.016, data, now);
    const home = { x: world.agents[0]!.x, y: world.agents[0]!.y };

    data = reduce(data, { type: 'task.upserted', task: task({ agentId: 'a' }) }, now);
    world.update(0.016, data, now); // first sight of the task
    data = reduce(data, { type: 'task.event', taskId: 't', agentId: 'a', event: { kind: 'tool.start', step: 1, callId: 'c', tool: 'read_file', input: {}, seq: 1, at: '2026-09-27T10:00:01Z' } }, now);
    for (let i = 0; i < 120; i++) world.update(0.05, data, now + i * 50);
    const at = world.agents[0]!;
    expect([`${at.x},${at.y}`]).toContain('1,6'); // bookcase spot
    expect(at.pose).toBe('work');

    data = reduce(data, { type: 'task.event', taskId: 't', agentId: 'a', event: { kind: 'tool.end', step: 1, callId: 'c', tool: 'read_file', ok: true, output: '', seq: 2, at: '2026-09-27T10:00:02Z' } }, now);
    for (let i = 0; i < 200; i++) world.update(0.05, data, now + 6000 + i * 50);
    expect({ x: world.agents[0]!.x, y: world.agents[0]!.y }).toEqual(home);
  });
});
