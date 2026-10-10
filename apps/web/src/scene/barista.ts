/**
 * The barista: staff, not an agent. They work the strip behind the counter on a
 * loop (pull shots, put the cup out at the till end, wipe the counter, fetch mugs
 * off the wall shelf, look out over the café) and never take tasks.
 *
 * In this view someone behind the counter lines up on screen with what stands on
 * the counter about 1.6 tiles further along, so the loop keeps to where that's
 * low: everywhere but the espresso machine, which sits behind the display case.
 *
 * Like the street life, a pure function of time: no state, no hit-testing.
 */
import { box, viewFace } from './iso';
import { K } from './palette';
import type { DrawCtx } from './props';
import { agentLook, agentSprite, type AgentFrame, type AgentLook } from './sprites';

type Act = 'brew' | 'serve' | 'wipe' | 'shelf' | 'idle';
type Face = 'x+' | 'x-' | 'y+' | 'y-';

/** The walking line, close to the back bar so head and shoulders clear the counter. */
const LANE_Y = 0.95;
const WALK_SPEED = 0.9; // tiles per second
/** They stand on a raised duckboard behind the bar, so their shoulders and hands clear the counter. */
const DUCKBOARD = 5;
/** The middle of the counter (see GROUND in layout.ts): things on it sort just after it. */
const COUNTER_MID_X = 11.7;
const COUNTER_MID_Y = 2.6;

/** Where they stop, which way they face there, and for how long (seconds). */
const STOPS: ReadonlyArray<{ x: number; act: Act; face: Face; dur: number }> = [
  { x: 10.75, act: 'brew', face: 'y-', dur: 6 }, // the espresso machine
  { x: 12.25, act: 'serve', face: 'y+', dur: 3 }, // the till end, where agents queue
  { x: 12.0, act: 'wipe', face: 'y+', dur: 5 },
  { x: 12.55, act: 'shelf', face: 'y-', dur: 4 }, // mugs off the wall shelf
  { x: 11.6, act: 'idle', face: 'y+', dur: 4 },
];

interface Leg {
  t0: number;
  /** Walking from x0 to x1, then standing at stop `i`. */
  x0: number;
  x1: number;
  walk: number;
  i: number;
}

const LEGS: Leg[] = [];
let CYCLE = 0;
STOPS.forEach((s, i) => {
  const from = STOPS[(i + STOPS.length - 1) % STOPS.length]!.x;
  const walk = Math.abs(s.x - from) / WALK_SPEED;
  LEGS.push({ t0: CYCLE, x0: from, x1: s.x, walk, i });
  CYCLE += walk + s.dur;
});

/** The cup they made stays on the counter this long after it's put down. */
const CUP_STAYS = 14;
const SERVE = LEGS.find((l) => STOPS[l.i]!.act === 'serve')!;
/** Cycle time at which the cup lands on the counter (halfway through serving). */
const CUP_DOWN = SERVE.t0 + SERVE.walk + STOPS[SERVE.i]!.dur / 2;

export interface BaristaState {
  x: number;
  y: number;
  face: Face;
  walking: boolean;
  act: Act | null;
  /** Seconds into the current walk or stop (animation). */
  t: number;
  /** Holding the cup they just made. */
  carrying: boolean;
  /** The finished cup is waiting on the counter. */
  cupOut: boolean;
}

export function baristaAt(t: number): BaristaState {
  const ph = ((t % CYCLE) + CYCLE) % CYCLE;
  const leg = [...LEGS].reverse().find((l) => ph >= l.t0)!;
  const stop = STOPS[leg.i]!;
  const into = ph - leg.t0;
  const brewEnd = LEGS[0]!.walk + STOPS[0]!.dur;
  const carrying = ph >= brewEnd && ph < CUP_DOWN;
  const cupOut = ph >= CUP_DOWN && ph < CUP_DOWN + CUP_STAYS;
  if (into < leg.walk) {
    const k = into / leg.walk;
    return { x: leg.x0 + (leg.x1 - leg.x0) * k, y: LANE_Y, face: leg.x1 > leg.x0 ? 'x+' : 'x-', walking: true, act: null, t: into, carrying, cupOut };
  }
  return { x: stop.x, y: LANE_Y, face: stop.face, walking: false, act: stop.act, t: into - leg.walk, carrying, cupOut };
}

const LOOK: AgentLook = { ...agentLook(7, 'apron'), accessory: 'visor' };
const back = (f: Face) => { const v = viewFace(f); return v === 'x-' || v === 'y-'; };

function frameOf(s: BaristaState): { frame: AgentFrame; bob: number } {
  if (s.walking) {
    const seq: AgentFrame[] = back(s.face) ? ['backWalkA', 'backStand', 'backWalkB', 'backStand'] : ['walkA', 'stand', 'walkB', 'stand'];
    const k = Math.floor(s.t * 7) % 4;
    return { frame: seq[k]!, bob: k % 2 ? -1 : 0 };
  }
  // Busy hands: a small bob while working at the machine, the shelf or the counter.
  const busy = s.act === 'brew' || s.act === 'shelf' || s.act === 'wipe';
  return { frame: back(s.face) ? 'backStand' : 'stand', bob: busy && Math.floor(s.t * 3) % 2 ? -1 : 0 };
}

type Push = (x: number, y: number, bias: number, f: () => void) => void;

/** The barista, their cup and their cloth, sorted in with the café's front layer. */
export function barista(c: DrawCtx, push: Push) {
  const s = baristaAt(c.t);
  // Sorted as if level with the counter's middle, so from every side they land between
  // the back bar and the counter (which hides their legs from the front).
  push(COUNTER_MID_X, LANE_Y, 0, () => {
    const { R, P } = c;
    const feet = P(s.x, s.y, DUCKBOARD);
    const { frame, bob } = frameOf(s);
    const { grid: g, palette } = agentSprite(frame, LOOK);
    const top = feet[1] - g.length + 1 + bob;
    const vf = viewFace(s.face);
    R.grid(g, palette, feet[0] - 7, top, vf === 'y+' || vf === 'x-');
    if (s.carrying) {
      // A takeaway cup at chest height, on the side they're heading.
      const hx = feet[0] + (s.face === 'x-' ? -7 : 5), hy = top + 11;
      R.rect(hx, hy, 3, 4, '#fbf6ec');
      R.rect(hx, hy + 1, 3, 1, '#b5835a');
      R.rect(hx - 1, hy - 1, 5, 1, K.ink);
    }
  });
  // The finished cup, at the counter's front corner past the cake dome.
  if (s.cupOut) push(COUNTER_MID_X, COUNTER_MID_Y, 0.05, () => takeaway(c, 13.6, 2.86));
  if (s.act === 'wipe') {
    push(COUNTER_MID_X, COUNTER_MID_Y, 0.06, () => {
      const { R, P } = c;
      // The clear strip at the back of the counter, between the display case and the cake.
      const q = P(13.35 + Math.sin(s.t * 5) * 0.2, 2.22, 15);
      R.rect(q[0] - 2, q[1] - 1, 4, 2, '#e6eef2');
      R.rect(q[0] - 2, q[1], 4, 1, '#b9c6cc');
    });
  }
}

/** A takeaway cup with a lid and sleeve, on the counter top (z 15). */
function takeaway(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x, y, 15, 0.13, 0.13, 5, '#fbf6ec', { line: true });
  box(R, P, x, y, 16, 0.13, 0.13, 2, '#b5835a');
  box(R, P, x - 0.01, y - 0.01, 20, 0.15, 0.15, 1, K.ink);
}
