/**
 * The café cats: pure ambience. They wander between favourite spots, sit, loaf
 * and nap, and never react to orchestrator state. Each cat has its own seeded
 * random stream, so a given cat always makes the same choices (stable snapshots).
 */
import type { ProviderId } from '@agent-cafe/shared';
import { cellCenter, FLOORS, gridSize, isBlockedCell, type CatSpot, type Dir, type FloorLayout, type Pt } from './layout';
import { findPath } from './pathfinding';

export type CatPose = 'walk' | 'sit' | 'loaf' | 'sleep';

export interface CatView {
  id: string;
  floor: ProviderId;
  /** Index into the fur palettes. */
  fur: number;
  x: number;
  y: number;
  /** Px above the floor surface. */
  z: number;
  face: Dir;
  pose: CatPose;
  /** Seconds in the current pose. */
  t: number;
}

const WALK_SPEED = 1.3; // tiles per second: an unhurried amble
const Z_SPEED = 40; // px per second when hopping on and off things

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class CatSim {
  view: CatView;
  private readonly rand: () => number;
  private readonly floor: FloorLayout;
  private path: Pt[] = [];
  private goal: CatSpot;
  private restFor: number;
  /** Cells agents use (seats, stations): cats don't loiter on them. */
  private readonly busy: Pt[];

  constructor(id: string, floorId: ProviderId, fur: number, seed: number, start: number) {
    this.rand = rng(seed);
    this.floor = FLOORS[floorId];
    this.busy = [...this.floor.seats, ...Object.values(this.floor.stations).flat(), this.floor.entrance];
    const spot = this.floor.catSpots[start % this.floor.catSpots.length]!;
    this.goal = spot;
    this.view = { id, floor: floorId, fur, x: spot.x, y: spot.y, z: spot.z ?? 0, face: 'y+', pose: 'sit', t: 0 };
    this.restFor = 0;
    this.rest(spot);
  }

  update(dt: number, taken: (p: Pt, self: CatView) => boolean): void {
    const v = this.view;
    if (this.path.length) {
      // Hop down before setting off; hop up on the final step.
      const onLast = this.path.length === 1;
      const zGoal = onLast ? this.goal.z ?? 0 : 0;
      v.z += Math.sign(zGoal - v.z) * Math.min(Math.abs(zGoal - v.z), Z_SPEED * dt);
      if (!onLast && v.z > 0) return this.setPose('walk', dt);

      let budget = WALK_SPEED * dt;
      while (budget > 0 && this.path.length) {
        const next = this.path[0]!;
        const dx = next.x - v.x, dy = next.y - v.y;
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
      if (!this.path.length) {
        v.z = this.goal.z ?? 0;
        this.rest(this.goal);
      } else this.setPose('walk', dt);
      return;
    }

    this.restFor -= dt;
    this.setPose(v.pose, dt);
    if (this.restFor <= 0) this.wander(taken);
  }

  /** Someone gave this cat a scratch. Awake and settled, it sits up and stays a while; asleep, it sleeps on. */
  pet(): void {
    if (this.path.length || this.view.pose === 'sleep') return;
    this.setPose('sit', 0);
    this.restFor = Math.max(this.restFor, 6);
  }

  private rest(spot: CatSpot) {
    const r = this.rand();
    const pose: CatPose = spot.nap ? (r < 0.7 ? 'sleep' : 'loaf') : r < 0.5 ? 'sit' : r < 0.8 ? 'loaf' : 'sleep';
    this.view.pose = pose;
    this.view.t = 0;
    // Naps are long; sitting about is short.
    const [lo, hi] = pose === 'sleep' ? [18, 45] : pose === 'loaf' ? [8, 20] : [4, 10];
    this.restFor = lo + this.rand() * (hi - lo);
  }

  private wander(taken: (p: Pt, self: CatView) => boolean) {
    const spots = this.floor.catSpots.filter((s) => s !== this.goal && !taken(s, this.view));
    let target: CatSpot | undefined;
    if (spots.length && this.rand() < 0.65) target = spots[Math.floor(this.rand() * spots.length)];
    else target = this.randomCell();
    const path = target && findPath(this.floor, this.view, target);
    if (!target || !path || !path.length) {
      this.rest(this.goal); // nowhere to go: stay put a while longer
      return;
    }
    this.goal = target;
    this.path = path;
  }

  /** A free cell away from where agents sit and work. */
  private randomCell(): CatSpot | undefined {
    const { cols, rows } = gridSize(this.floor);
    for (let tries = 0; tries < 20; tries++) {
      const i = Math.floor(this.rand() * cols), j = Math.floor(this.rand() * rows);
      if (isBlockedCell(this.floor, i, j)) continue;
      const c = cellCenter(i, j);
      if (this.busy.some((b) => Math.hypot(b.x - c.x, b.y - c.y) < 0.8)) continue;
      return c;
    }
    return undefined;
  }

  private setPose(pose: CatPose, dt: number) {
    if (this.view.pose !== pose) {
      this.view.pose = pose;
      this.view.t = 0;
    } else this.view.t += dt;
  }
}

/** Who lives here: two cats downstairs, one in the loft. */
const RESIDENTS: Array<{ id: string; floor: ProviderId; fur: number; seed: number; start: number }> = [
  { id: 'cat-ink', floor: 'openai', fur: 0, seed: 7, start: 0 },
  { id: 'cat-marmalade', floor: 'openai', fur: 1, seed: 19, start: 3 },
  { id: 'cat-pebble', floor: 'anthropic', fur: 2, seed: 31, start: 0 },
];

export class Cats {
  private readonly sims = RESIDENTS.map((r) => new CatSim(r.id, r.floor, r.fur, r.seed, r.start));

  get views(): CatView[] {
    return this.sims.map((s) => s.view);
  }

  /** Pet a cat by id (unknown ids are ignored). */
  pet(id: string): void {
    this.sims.find((s) => s.view.id === id)?.pet();
  }

  update(dt: number): void {
    const step = Math.min(dt, 0.1);
    // A spot is taken if another cat on the same floor is sitting on it.
    const taken = (p: Pt, self: CatView) =>
      this.sims.some((s) => s.view !== self && s.view.floor === self.floor && Math.hypot(s.view.x - p.x, s.view.y - p.y) < 0.6);
    for (const s of this.sims) s.update(step, taken);
  }
}
