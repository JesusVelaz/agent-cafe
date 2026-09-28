/**
 * The simulation layer: turns orchestrator state into positions, poses and speech
 * bubbles, frame by frame. Knows nothing about Pixi; the renderer just draws the
 * AgentView list.
 *
 * Why a separate animation clock: in mock mode (and for fast local tools) server
 * events arrive faster than a walk takes. Agents keep a short queue of *visits*
 * (stations to walk to) and play them at a readable pace, dropping old ones if
 * they fall behind, so the scene lags reality by at most a couple of seconds.
 */
import type { AgentDTO, ProviderId, TaskDTO } from '@agent-cafe/shared';
import { activeTaskFor, latestTaskFor, type CafeData } from '@/store/reduce';
import { deriveActivity, stationFor, type Activity } from './activity';
import { FLOORS, type Dir, type FloorLayout, type Pt, type Spot, type StationId } from './layout';
import { findPath } from './pathfinding';

export type Pose = 'stand' | 'walk' | 'sit' | 'type' | 'work' | 'slump' | 'sleep';

export type Bubble =
  | { kind: 'think' }
  | { kind: 'tool'; tool: string }
  /** Raised hand: waiting for the user to allow or deny something. */
  | { kind: 'ask' }
  | { kind: 'wait' }
  | { kind: 'done' }
  | { kind: 'fail' }
  | { kind: 'zzz' };

export interface AgentView {
  id: string;
  name: string;
  providerId: ProviderId;
  spriteSeed: number;
  demo: boolean;
  x: number;
  y: number;
  face: Dir;
  pose: Pose;
  /** Seconds spent in the current pose; drives frame animation. */
  t: number;
  bubble: Bubble | null;
  activity: Activity;
  queued: number;
}

interface Visit {
  station: StationId;
  tool?: string;
  /** Minimum seconds to stay once arrived. */
  dwell: number;
}

const WALK_SPEED = 2.6; // tiles per second
const MAX_VISITS = 2;
const TOOL_DWELL = 1.4;
const DELIVER_DWELL = 1.1;

class AgentSim {
  view: AgentView;
  private path: Pt[] = [];
  private goal: Spot | null = null;
  private visits: Visit[] = [];
  private arrivedFor = 0;
  private seenSeq = new Map<string, number>();
  private lastTaskStatus = new Map<string, TaskDTO['status']>();

  constructor(
    agent: AgentDTO,
    private readonly floor: FloorLayout,
    public home: Spot,
    spawn: Pt,
  ) {
    this.view = {
      id: agent.id,
      name: agent.name,
      providerId: agent.providerId,
      spriteSeed: agent.spriteSeed,
      demo: false,
      x: spawn.x,
      y: spawn.y,
      face: home.face,
      pose: 'sit',
      t: 0,
      bubble: null,
      activity: { kind: 'idle' },
      queued: 0,
    };
  }

  /** Pull new tool calls / completions for this agent out of the store data. */
  observe(data: CafeData, now: number): void {
    const v = this.view;
    const active = activeTaskFor(data, v.id);
    const latest = latestTaskFor(data, v.id);
    v.activity = deriveActivity({
      activeTask: active,
      latestTask: latest,
      lastEvent: active ? data.lastEvent[active.id] : undefined,
      lastActivityAt: active ? data.lastActivityAt[active.id] : undefined,
      now,
    });
    v.demo = (active ?? latest)?.isMock ?? data.providers[v.providerId]?.mode === 'mock';
    v.queued = Object.values(data.tasks).filter((t) => t.agentId === v.id && t.status === 'queued').length;

    const task = active ?? latest;
    if (!task) return;

    // New tool calls → visits. On first sight of a task, skip its history.
    const events = data.events[task.id] ?? [];
    const lastSeq = events.at(-1)?.seq ?? -1;
    if (!this.seenSeq.has(task.id)) {
      this.seenSeq.set(task.id, lastSeq);
    } else {
      const seen = this.seenSeq.get(task.id)!;
      for (const e of events) {
        if (e.seq > seen && e.kind === 'tool.start') {
          const station = stationFor(e.tool);
          if (station) this.pushVisit({ station, tool: e.tool, dwell: TOOL_DWELL });
        }
      }
      this.seenSeq.set(task.id, Math.max(seen, lastSeq));
    }

    // Running → completed: carry the order to the pickup counter.
    const prev = this.lastTaskStatus.get(task.id);
    if (prev && prev !== task.status && task.status === 'completed') {
      this.pushVisit({ station: 'pickup', dwell: DELIVER_DWELL });
    }
    if (task.status !== 'completed' && task.status !== 'failed') {
      // A cancelled/failed task abandons any errands.
      if (task.status === 'cancelled' || task.status === 'interrupted') this.visits = [];
    }
    this.lastTaskStatus.set(task.id, task.status);
  }

  private pushVisit(v: Visit) {
    this.visits.push(v);
    // Falling behind? Drop the oldest errands; the scene should never lag far.
    while (this.visits.length > MAX_VISITS) this.visits.shift();
  }

  update(dt: number, claim: (station: StationId, agentId: string) => Spot): void {
    const v = this.view;
    const visit = this.visits[0];
    const target = visit ? claim(visit.station, v.id) : this.home;

    if (!this.goal || this.goal.x !== target.x || this.goal.y !== target.y) {
      this.goal = target;
      this.path = findPath(this.floor, v, target) ?? [];
      this.arrivedFor = 0;
    }

    // Walk.
    if (this.path.length) {
      let budget = WALK_SPEED * dt;
      while (budget > 0 && this.path.length) {
        const next = this.path[0]!;
        const dx = next.x - v.x;
        const dy = next.y - v.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.0001) v.face = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'x+' : 'x-') : dy > 0 ? 'y+' : 'y-';
        if (dist <= budget) {
          v.x = next.x;
          v.y = next.y;
          budget -= dist;
          this.path.shift();
        } else {
          v.x += (dx / dist) * budget;
          v.y += (dy / dist) * budget;
          budget = 0;
        }
      }
      this.setPose('walk', dt);
      v.bubble = visit?.tool ? { kind: 'tool', tool: visit.tool } : this.ambientBubble();
      return;
    }

    // Arrived.
    v.x = target.x;
    v.y = target.y;
    v.face = target.face;
    this.arrivedFor += dt;

    if (visit) {
      const stillUsingTool =
        visit.tool && v.activity.kind === 'tool' && v.activity.tool === visit.tool && this.arrivedFor < 6;
      this.setPose('work', dt);
      v.bubble = visit.tool
        ? this.arrivedFor > 0.6 && stillUsingTool
          ? { kind: 'wait' }
          : { kind: 'tool', tool: visit.tool }
        : { kind: 'done' };
      if (this.arrivedFor >= visit.dwell && !stillUsingTool) {
        this.visits.shift();
        this.goal = null;
      }
      return;
    }

    // At home: pose follows the activity.
    switch (v.activity.kind) {
      case 'thinking':
      case 'tool': // tool running but its visit was dropped/finished: keep working
        this.setPose('type', dt);
        break;
      case 'stuck':
        this.setPose('sleep', dt);
        break;
      case 'failed':
        this.setPose('slump', dt);
        break;
      default:
        this.setPose('sit', dt);
    }
    v.bubble = this.ambientBubble();
  }

  private ambientBubble(): Bubble | null {
    switch (this.view.activity.kind) {
      case 'thinking':
        return { kind: 'think' };
      case 'tool':
        return { kind: 'tool', tool: this.view.activity.tool };
      case 'approval':
        return { kind: 'ask' };
      case 'stuck':
        return { kind: 'zzz' };
      case 'done':
        return { kind: 'done' };
      case 'failed':
        return { kind: 'fail' };
      default:
        return null;
    }
  }

  private setPose(pose: Pose, dt: number) {
    if (this.view.pose !== pose) {
      this.view.pose = pose;
      this.view.t = 0;
    } else {
      this.view.t += dt;
    }
  }
}

export class World {
  private sims = new Map<string, AgentSim>();
  private initialised = false;

  get agents(): AgentView[] {
    return [...this.sims.values()].map((s) => s.view);
  }

  update(dt: number, data: CafeData, now: number): void {
    if (!data.hydrated) return;
    const live = Object.values(data.agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    // Reconcile the roster.
    const liveIds = new Set(live.map((a) => a.id));
    for (const id of this.sims.keys()) if (!liveIds.has(id)) this.sims.delete(id);
    const seatIndex: Partial<Record<ProviderId, number>> = {};
    for (const agent of live) {
      const floor = FLOORS[agent.providerId];
      const i = (seatIndex[agent.providerId] = (seatIndex[agent.providerId] ?? -1) + 1);
      const home = floor.seats[i % floor.seats.length]!;
      let sim = this.sims.get(agent.id);
      if (!sim) {
        sim = new AgentSim(agent, floor, home, this.initialised ? floor.entrance : home);
        this.sims.set(agent.id, sim);
      }
      sim.home = home;
      sim.view.name = agent.name;
    }
    this.initialised = true;

    // Station spots are claimed first-come per frame so agents don't stack.
    const claimed = new Map<string, string>();
    const claim = (station: StationId, agentId: string): Spot => {
      const sim = this.sims.get(agentId)!;
      const spots = FLOORS[sim.view.providerId].stations[station];
      const free = spots.find((sp) => {
        const who = claimed.get(`${sim.view.providerId}:${sp.x},${sp.y}`);
        return !who || who === agentId;
      });
      const spot = free ?? spots[0]!;
      claimed.set(`${sim.view.providerId}:${spot.x},${spot.y}`, agentId);
      return spot;
    };

    for (const sim of this.sims.values()) {
      sim.observe(data, now);
      sim.update(Math.min(dt, 0.1), claim);
    }
  }
}
