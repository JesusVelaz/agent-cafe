/**
 * Ambient motion around the café: the sky, street life, the breeze and small
 * critters. Pure decoration, like the cats.
 *
 * Everything here is a pure function of time and fixed seeds: who walks by,
 * which car passes, where a cloud is. A frame at a given t is always the same
 * frame, so snapshots stay stable and there is no simulation state to keep.
 */
import { BUILDING } from '@/sim/layout';
import { isDim, THEMES } from './atmosphere';
import { MAX_FRAME, perArea, plotOffset, SCENE_W } from './frame';
import { box, plane } from './iso';
import { hash, K, mix, shade } from './palette';
import type { DrawCtx } from './props';
import type { Raster } from './raster';
import { agentGrid, agentLook, BIRD, BUTTERFLY, DOG_COLLAR, DOG_PAL, DOG_W, dogGrid, PIGEON, PIGEON_PAL, type AgentFrame, type DogFrame } from './sprites';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const sunny = (c: DrawCtx) => c.theme === 'day' || c.theme === 'summer';

// ── sky ─────────────────────────────────────────────────────────────────────

interface Cloud {
  /** Fraction of the frame height. */
  y: number;
  w: number;
  /** Drift speed (px/s) and starting phase (0–1). */
  v: number;
  s: number;
  far: boolean;
}

/** Screen-space clouds, all in the sky above the plot. */
const CLOUDS: Cloud[] = [
  { y: 0.04, w: 48, v: 2.6, s: 0.1, far: false },
  { y: 0.14, w: 30, v: 1.4, s: 0.55, far: true },
  { y: 0.22, w: 36, v: 1.9, s: 0.82, far: true },
  { y: 0.09, w: 24, v: 1.2, s: 0.33, far: true },
  { y: 0.28, w: 40, v: 2.2, s: 0.68, far: false },
];
/** Extra clouds when it rains. */
const STORM: Cloud[] = [{ y: 0.17, w: 40, v: 4.2, s: 0.62, far: false }, { y: 0.3, w: 34, v: 3.6, s: 0.12, far: true }, { y: 0.02, w: 44, v: 3.8, s: 0.87, far: false }];

/** A seeded cloud for the sky beyond the hand-placed ones; lower ones only show beside the plot. */
function extraCloud(i: number, storm: boolean): Cloud {
  const k = i * 19 + (storm ? 7 : 0);
  const far = hash(k + 1) < 0.5;
  return { y: 0.02 + 0.5 * hash(k + 2), w: 22 + Math.round(28 * hash(k + 3)), v: (far ? 1 : 1.8) + 1.2 * hash(k + 4), s: hash(k + 5), far };
}

/**
 * The sky is laid out as wide as the widest frame, so its clouds don't depend on the
 * frame's width: a narrower frame just crops it on the right. Opening the work board
 * narrows the stage, and the clouds on the left must stay put rather than jump or vanish.
 */
const SKY_W = MAX_FRAME.w;

/** The hand-placed clouds, plus seeded ones so the whole sky (and a taller frame) stays as cloudy. */
function skyClouds(h: number, storm: boolean): Cloud[] {
  const sky = { w: SKY_W, h };
  const fill = (base: Cloud[], isStorm: boolean) => [...base, ...Array.from({ length: Math.max(0, perArea(base.length, sky) - base.length) }, (_, i) => extraCloud(i, isStorm))];
  return storm ? [...fill(CLOUDS, false), ...fill(STORM, true)] : fill(CLOUDS, false);
}

/** The clouds in this frame at time t, in frame pixels from its left edge. */
export function cloudsAt(R: Pick<Raster, 'w' | 'h'>, storm: boolean, t: number) {
  const speed = storm ? 2 : 1;
  return skyClouds(R.h, storm)
    .map((cl, i) => {
      const span = SKY_W + cl.w + 24;
      const x = ((cl.s * span + t * cl.v * speed) % span) - cl.w - 12;
      return { x: Math.round(x), y: Math.round(cl.y * R.h), w: cl.w, far: cl.far, seed: i + 1 };
    })
    .filter((cl) => cl.x < R.w);
}

function cloudColours(c: DrawCtx): [string, string] {
  switch (c.theme) {
    case 'night': return ['#3b4568', '#2c3454'];
    case 'rain': return ['#9aa4ae', '#76818c'];
    case 'snow': return ['#f1f4f7', '#cfd8e1'];
    case 'summer': return ['#fff8ec', '#f3dcc0'];
    default: return ['#ffffff', '#dfe9f0'];
  }
}

/** A filled pixel circle, cut off flat at `base`. */
function circle(R: Raster, cx: number, cy: number, r: number, col: string, base: number) {
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    const y = Math.round(cy + dy);
    if (y > base) continue;
    const half = Math.sqrt(Math.max(0, r * r - dy * dy));
    if (half < 0.5) continue;
    R.rect(cx - half, y, Math.round(half * 2), 1, col, 1, true);
  }
}

/** A flat-bottomed cloud: a shade layer two pixels down, then the body. */
function cloud(R: Raster, x: number, y: number, w: number, seed: number, body: string, under: string) {
  const h = Math.max(8, Math.round(w * 0.3));
  const base = y + h;
  const n = 3 + Math.floor(hash(seed) * 2);
  const bumps = Array.from({ length: n }, (_, i) => ({ cx: x + w * (0.18 + (0.64 * i) / (n - 1)), r: h * (0.5 + 0.5 * hash(seed * 7 + i)) }));
  for (const [col, off] of [[under, 2], [body, 0]] as const) {
    for (const b of bumps) circle(R, b.cx, base - b.r * 0.85 + off, b.r, col, base + off);
    R.rect(x, base - 3 + off, w, 4, col, 1, true);
  }
}

function moon(R: Raster) {
  // Over the plot's top-left, wherever the plot sits in the frame.
  const x = plotOffset(R).x + Math.round(SCENE_W * 0.12), y = 34;
  circle(R, x, y, 6, '#f4ecc8', y + 7);
  R.rect(x - 2, y - 2, 2, 2, '#ded3a8', 1, true);
  R.rect(x + 2, y + 1, 1, 1, '#ded3a8', 1, true);
  R.rect(x - 1, y + 3, 2, 1, '#ded3a8', 1, true);
}

/** Moon, clouds, a passing flock and the odd plane. Drawn over the backdrop, behind the café. */
export function drawSky(c: DrawCtx) {
  const { R, t, theme } = c;
  if (theme === 'night') moon(R);
  const [body, under] = cloudColours(c);
  const bg = THEMES[theme].bg[0];
  const list = cloudsAt(R, theme === 'rain', t);
  for (const far of [true, false]) {
    for (const cl of list) {
      if (cl.far !== far) continue;
      const tint = far ? 0.45 : 0;
      cloud(R, cl.x, cl.y, cl.w, cl.seed, mix(body, bg, tint), mix(under, bg, tint));
    }
  }
  if (sunny(c)) {
    // A flock every 30 s, crossing in about 20.
    const k = Math.floor(t / 30), ph = t - k * 30, dur = (R.w + 60) / 24;
    if (ph < dur) {
      const fx = -30 + ph * 24, fy = 26 + hash(k * 3) * 30 + Math.sin(ph * 1.2) * 3;
      const flock = [[0, 0], [-7, -3], [-7, 4], [-14, -6], [-14, 7]] as const;
      flock.forEach(([dx, dy], i) => R.grid(BIRD[Math.floor(t * 6 + i * 1.7) % 2]!, { k: '#4a4150' }, fx + dx, fy + dy, false, 'k'));
    }
    // A plane with a contrail now and then.
    const pk = Math.floor((t + 40) / 75), pph = t + 40 - pk * 75, pdur = (R.w + 80) / 34;
    if (pph < pdur) {
      const px = -20 + pph * 34, py = 14 + hash(pk) * 8;
      for (let i = 2; i < 60; i++) R.px(px - i, py + 1 + Math.floor(i / 30), '#ffffff', clamp(0.8 - i / 60, 0, 1), true);
      R.rect(px, py, 6, 2, '#e9edf1', 1, true); R.px(px + 2, py - 1, '#c9d0d6', 1, true); R.px(px + 6, py + 1, '#c9d0d6', 1, true);
    }
  }
}

/** Soft cloud shadows sliding across the plot on sunny days. */
export function cloudShadows(c: DrawCtx) {
  if (!sunny(c)) return;
  const { R, P, t } = c;
  const [ox, oy] = P(0, 0);
  for (const [s, sy] of [[0.15, 3.5], [0.6, 10.5]] as const) {
    const sx = ((t * 0.22 + s * 40) % 40) - 10, rx = 2.8, ry = 1.9;
    const pts = [P(sx - rx, sy - ry), P(sx + rx, sy - ry), P(sx + rx, sy + ry), P(sx - rx, sy + ry)];
    const x0 = Math.max(0, Math.min(...pts.map((p) => p[0]))), x1 = Math.min(R.w - 1, Math.max(...pts.map((p) => p[0])));
    const y0 = Math.max(0, Math.min(...pts.map((p) => p[1]))), y1 = Math.min(R.h - 1, Math.max(...pts.map((p) => p[1])));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * R.w + x, o = i * 4;
        if (R.em[i] || R.d[o + 3] !== 255) continue;
        const a = (x - ox) / 12, b = (y - oy) / 6, wx = (a + b) / 2, wy = (b - a) / 2;
        if (wx < 0 || wy < 0 || wx > BUILDING.PW || wy > BUILDING.PD) continue;
        const dd = ((wx - sx) / rx) ** 2 + ((wy - sy) / ry) ** 2;
        if (dd >= 1 - 0.18 * (((x * 5 + y * 3) % 4) / 4)) continue;
        R.d[o] = R.d[o]! * 0.84;
        R.d[o + 1] = R.d[o + 1]! * 0.86;
        R.d[o + 2] = R.d[o + 2]! * 0.92;
      }
    }
  }
}

// ── street life ─────────────────────────────────────────────────────────────

type Push = (d: number, f: () => void) => void;

/** Fade in and out over the last tile at each end of the plot. */
const edgeFade = (x: number, len = 0) => clamp(Math.min(x + 0.4, BUILDING.PW - x - len + 0.4), 0, 1);

const WALK_CYCLE = 26;
const WALK_SPEED = 1; // tiles per second

/** Who is on the sidewalk at time t (one passer-by per cycle, alternating sides at random). */
function walkerAt(t: number) {
  const k = Math.floor(t / WALK_CYCLE), ph = t - k * WALK_CYCLE;
  const dir = hash(k * 3 + 1) > 0.5 ? 1 : -1;
  const x = dir > 0 ? -0.6 + ph * WALK_SPEED : BUILDING.PW + 0.6 - ph * WALK_SPEED;
  return { k, ph, dir, x, on: ph < BUILDING.PW + 1.2 };
}

const smooth = (x: number, a: number, b: number) => { const u = clamp((x - a) / (b - a), 0, 1); return u * u * (3 - 2 * u); };
/**
 * The walking line along the shopfront: behind the A-board, clear of the bench,
 * planters and bike rack, stepping out round the patio planter.
 */
const laneY = (x: number) => 11.45 + 0.5 * smooth(x, 14.1, 14.7) * (1 - smooth(x, 15.7, 16.3));
/** The dog keeps to the street side of its owner, so it stays in view, and tucks in behind the A-board. */
const dogLaneY = (x: number) => laneY(x) + 0.38 * (1 - smooth(x, 12.3, 12.8) * (1 - smooth(x, 13.7, 14.2)));

/**
 * How far the dog is ahead of its owner. Once per walk it stops to sniff
 * (the owner walks on past it), then trots to catch up.
 */
function dogLead(k: number, ph: number) {
  const lead = 0.95, stop = 1.6, s0 = 4 + hash(k * 9 + 4) * 10;
  if (ph < s0) return lead;
  if (ph < s0 + stop) return lead - (ph - s0) * WALK_SPEED;
  if (ph < s0 + stop * 2) return lead - stop * WALK_SPEED + (ph - s0 - stop) * WALK_SPEED;
  return lead;
}

function walkFrame(t: number, back: boolean): AgentFrame {
  const seq: AgentFrame[] = back ? ['backWalkA', 'backStand', 'backWalkB', 'backStand'] : ['walkA', 'stand', 'walkB', 'stand'];
  return seq[Math.floor(t * 7) % 4]!;
}

function walker(c: DrawCtx, push: Push) {
  const w = walkerAt(c.t);
  if (!w.on) return;
  const a = edgeFade(w.x);
  const wy = laneY(w.x);
  const look = agentLook(1000 + w.k * 17, w.k % 2 ? 'casual' : 'office');
  const back = w.dir < 0;
  if (a > 0) {
    // A small depth bias only: the A-board stands just in front of the lane.
    push(w.x + wy + 0.2, () => {
      const { R, P, t, theme } = c;
      const feet = P(w.x, wy, 0);
      const g = agentGrid(walkFrame(t, back), look);
      R.rect(feet[0] - 3, feet[1] - 1, 7, 3, '#000000', 0.12 * a);
      R.grid(g, look.palette, feet[0] - 7, feet[1] - g.length + 1, back, '', a);
      if (theme === 'rain') {
        // Umbrella over the head.
        const top = feet[1] - 26;
        R.poly([[feet[0] - 10, top + 5], [feet[0], top], [feet[0] + 10, top + 5]], K.teal, a);
        R.rect(feet[0] - 10, top + 5, 21, 1, shade(K.teal, -0.3), a);
        R.line(feet[0], top + 5, feet[0], top + 12, K.ink, a);
      }
    });
  }

  // About a third of passers-by walk a dog.
  if (hash(w.k * 5 + 2) < 0.62) return;
  const dogAt = (ph: number) => w.x + w.dir * dogLead(w.k, ph) + (ph - w.ph) * w.dir * WALK_SPEED;
  const dx = dogAt(w.ph), dy = dogLaneY(dx);
  const da = edgeFade(dx);
  if (da <= 0 && a <= 0) return;
  // Ground speed decides the gait: sniffing when stopped, a quicker trot when catching up.
  const speed = Math.abs(dogAt(w.ph + 0.05) - dogAt(w.ph - 0.05)) / 0.1;
  const sniffing = speed < 0.2;
  const frame: DogFrame = sniffing ? 'sniff' : (['stand', 'strideA', 'stand', 'strideB'] as const)[Math.floor(Math.abs(dx) * 5) % 4]!;
  const wag = Math.floor(c.t * (sniffing ? 8 : 4)) % 2 === 0;
  const flip = w.dir < 0;
  push(dx + dy + 0.1, () => {
    const { R, P } = c;
    const feet = P(dx, dy, 0);
    const g = dogGrid(frame, wag);
    R.rect(feet[0] - 6, feet[1], 13, 1, '#000000', 0.15 * da);
    R.grid(g, DOG_PAL, feet[0] - Math.floor(DOG_W / 2), feet[1] - g.length + 1, flip, '', da);
  });
  // The lead, drawn after both of them, sagging when there's slack.
  push(Math.max(w.x + wy + 0.2, dx + dy + 0.1) + 0.01, () => {
    const { R, P } = c;
    const feet = P(w.x, wy, 0), dfeet = P(dx, dy, 0);
    const hand: [number, number] = [feet[0] + (dfeet[0] > feet[0] ? 5 : -6), feet[1] - 5];
    // The collar cell of the sprite (mirrored when the dog faces left).
    const left = dfeet[0] - Math.floor(DOG_W / 2), top = dfeet[1] - dogGrid('stand', false).length + 1;
    const collar: [number, number] = [left + (flip ? DOG_W - 1 - DOG_COLLAR.x : DOG_COLLAR.x), top + DOG_COLLAR.y];
    const sag = Math.max(0, 4 - Math.hypot(collar[0] - hand[0], collar[1] - hand[1]) / 5);
    const mid: [number, number] = [(hand[0] + collar[0]) / 2, (hand[1] + collar[1]) / 2 + sag];
    const la = Math.min(a, da);
    R.line(hand[0], hand[1], mid[0], mid[1], K.berry, la);
    R.line(mid[0], mid[1], collar[0], collar[1], K.berry, la);
  });
}

/** Two pigeons by the bench. They scatter when someone walks past and drift back later. */
const PIGEON_HOME = [[4.2, 12.95], [4.8, 12.78]] as const;
function pigeons(c: DrawCtx, push: Push) {
  const w = walkerAt(c.t);
  const passAt = w.dir > 0 ? 4.5 + 0.6 : BUILDING.PW + 0.6 - 4.5;
  const leave = passAt - 1.4, back = passAt + 11;
  PIGEON_HOME.forEach(([hx, hy], i) => {
    let x = hx, y = hy, z = 0, flying = false, a = 1;
    if (w.ph >= leave && w.ph < back) {
      const away = w.ph - leave, ret = back - w.ph;
      const tau = Math.min(away, ret);
      if (tau > 3) return;
      flying = true;
      x = hx - tau * 1.6; y = hy + tau * 0.2 - i * 0.2 * tau; z = tau * 22;
      a = clamp(1.6 - tau * 0.5, 0, 1);
    }
    push(x + y + 0.2, () => {
      const { R, P, t } = c;
      const q = P(x, y, z);
      if (flying) { R.grid(BIRD[Math.floor(t * 8 + i) % 2]!, { k: '#6f7480' }, q[0] - 2, q[1] - 3, false, '', a); return; }
      const beat = Math.floor(t * 2.2 + i * 1.3);
      const fr = PIGEON[hash(beat * 3 + i) > 0.6 ? 1 : 0]!;
      const flip = hash(Math.floor(t / 4) * 7 + i) > 0.5;
      R.rect(q[0] - 2, q[1], 5, 1, '#000000', 0.15);
      R.grid(fr, PIGEON_PAL, q[0] - 3, q[1] - fr.length + 1, flip);
    });
  });
}

const CAR_COLS = ['#4f7fae', '#c9463d', '#e0a84a', '#5c8f5a', '#efe6d6', '#3a3f47', '#8a6fb8'];
const LANES = [
  { y: 14.55, dir: 1, period: 9.5, off: 0 },
  { y: 15.85, dir: -1, period: 12.5, off: 5 },
] as const;
const CAR_LEN = 2.0;

function car(c: DrawCtx, x: number, y: number, dir: number, col: string, a: number) {
  const { R, P, theme } = c;
  const dim = isDim(theme);
  const o = { a, line: a >= 1 ? true : undefined };
  box(R, P, x, y, 2, CAR_LEN, 0.8, 6, col, o);
  const cab = dir > 0 ? x + 0.4 : x + 0.55;
  box(R, P, cab, y + 0.06, 8, 1.05, 0.68, 5, col, o);
  if (theme === 'snow') box(R, P, cab, y + 0.06, 13, 1.05, 0.68, 1, '#ffffff', { a });
  plane(R, P, { y: y + 0.74 }, cab + 0.08, cab + 0.48, 8.5, 12, '#bfe3ea', a, dim);
  plane(R, P, { y: y + 0.74 }, cab + 0.56, cab + 0.97, 8.5, 12, '#bfe3ea', a, dim);
  plane(R, P, { x: cab + 1.05 }, y + 0.14, y + 0.68, 8.5, 12, '#a9d3e0', a, dim);
  for (const wx of [0.3, CAR_LEN - 0.6]) box(R, P, x + wx, y + 0.72, 0, 0.32, 0.1, 4, '#1e1e22', { a });
  // Lights: a pair at each end. Only the +x end faces us, so it shows both of its
  // lamps (heads going right, tails going left); the hidden end's lamps wrap round
  // the near side as a sliver at that corner.
  const near = dir > 0 ? HEADLIGHT : TAILLIGHT, far = dir > 0 ? TAILLIGHT : HEADLIGHT;
  for (const ly of [0.15, 0.62]) {
    const q = P(x + CAR_LEN, y + ly, 5);
    // A dark housing so the lamp reads on any paint, the lamp, and a hot spot.
    R.rect(q[0] - 1, q[1] - 1, 3, 3, LAMP_HOUSING, a);
    R.rect(q[0] - 1, q[1] - 1, 2, 2, near.lamp, a, dim);
    R.px(q[0] - 1, q[1] - 1, near.hot, a, dim);
  }
  const wrap = P(x + 0.04, y + 0.8, 5);
  R.rect(wrap[0], wrap[1] - 1, 2, 1, far.lamp, a, dim);
  if (dim && a >= 1) {
    const front = dir > 0 ? P(x + CAR_LEN + 1.2, y + 0.4, 0) : P(x - 1.2, y + 0.4, 0);
    c.lights.push({ x: front[0], y: front[1], r: 34, col: [1, 0.93, 0.72], s: 1 });
    const back = dir > 0 ? P(x - 0.3, y + 0.4, 2) : P(x + CAR_LEN + 0.3, y + 0.4, 2);
    c.lights.push({ x: back[0], y: back[1], r: 12, col: [1, 0.3, 0.28], s: 0.6 });
  }
}

const HEADLIGHT = { lamp: '#fff1c2', hot: '#ffffff' };
const TAILLIGHT = { lamp: '#e3203a', hot: '#ff9aa6' };
const LAMP_HOUSING = '#2b2124';

function traffic(c: DrawCtx, push: Push) {
  LANES.forEach((L, li) => {
    const tt = c.t + L.off, k = Math.floor(tt / L.period), ph = tt - k * L.period;
    if (hash(k * 7 + li) > 0.8) return;
    const speed = 2.6 + hash(k * 11 + li) * 1.2;
    const x = L.dir > 0 ? -CAR_LEN - 0.4 + ph * speed : BUILDING.PW + 0.4 - ph * speed;
    const a = edgeFade(x, CAR_LEN);
    if (a <= 0) return;
    const col = CAR_COLS[Math.floor(hash(k * 13 + li * 5) * CAR_COLS.length)]!;
    push(x + CAR_LEN / 2 + L.y + 0.4, () => car(c, x, L.y, L.dir, col, a));
  });
}

// ── critters ────────────────────────────────────────────────────────────────

const BLOOMS = [[8.3, 13.15], [11.9, 13.15], [15.15, 10.9]] as const;
const GLOW_SPOTS = [[2.2, 13.4], [19.2, 0.8], [17.0, 4.6], [16.9, 8.4], [9.0, 12.4]] as const;

function critters(c: DrawCtx, push: Push) {
  const { t } = c;
  if (sunny(c)) {
    BLOOMS.forEach(([bx, by], i) => {
      const x = bx + Math.cos(t * 0.8 + i * 2) * 0.6, y = by + Math.sin(t * 1.25 + i) * 0.35, z = 11 + Math.sin(t * 2.3 + i) * 4;
      push(x + y + 0.3, () => {
        const q = c.P(x, y, z);
        c.R.grid(BUTTERFLY[Math.floor(t * 9 + i) % 2]!, { w: i % 2 ? K.amber : '#f6efe2', k: K.ink }, q[0] - 1, q[1] - 1);
      });
    });
  }
  if (c.theme === 'night' || c.theme === 'summer') {
    GLOW_SPOTS.forEach(([gx, gy], j) => {
      for (let n = 0; n < 2; n++) {
        const i = j * 2 + n;
        const x = gx + Math.sin(t * 0.5 + i * 1.7) * 0.8, y = gy + Math.cos(t * 0.37 + i) * 0.6, z = 8 + Math.sin(t * 0.9 + i * 2.1) * 6;
        const glow = clamp(Math.sin(t * 1.7 + i * 2.4) * 1.4, 0, 1);
        if (glow <= 0.05) continue;
        push(x + y + 0.3, () => {
          const q = c.P(x, y, z);
          c.R.px(q[0], q[1], '#e9ff8a', glow, true);
          if (c.theme === 'night') c.lights.push({ x: q[0], y: q[1] + 2, r: 8, col: [0.8, 1, 0.5], s: 0.6 * glow });
        });
      }
    });
  }
}

/** Street life and critters, sorted in with the café's front layer. */
export function streetLife(c: DrawCtx, push: Push) {
  walker(c, push);
  pigeons(c, push);
  traffic(c, push);
  critters(c, push);
}
