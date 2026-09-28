/**
 * Draw functions for furniture, wall decor and the building shell.
 * Ported from the approved design mockup; each takes a DrawCtx so theme-aware
 * touches (candles at night, umbrellas in the rain) live next to the prop.
 */
import type { Decor, Prop } from '@/sim/layout';
import { isDim, THEMES, type Light, type ThemeId } from './atmosphere';
import { text } from './font';
import { box, disc, plane, planePt, quad, type Plane, type Proj } from './iso';
import { hash, K, mix, shade } from './palette';
import type { Raster } from './raster';
import { drawOutdoor } from './outdoor';
import { CAT_LOAF, CAT_PAL, CLOCK, CLOCK_PAL, PLANT_BIG, PLANT_HANG, PLANT_PAL, PLANT_SMALL } from './sprites';

export interface DrawCtx {
  R: Raster;
  P: Proj;
  t: number;
  theme: ThemeId;
  lights: Light[];
}

const warm = (x: number, y: number, r: number, s: number): Light => ({ x, y, r, col: [1, 0.82, 0.55], s });

// ── small pieces ────────────────────────────────────────────────────────────

function plantPot(c: DrawCtx, x: number, y: number, z: number, big: boolean) {
  const { R, P } = c;
  box(R, P, x - 0.18, y - 0.18, z, 0.36, 0.36, big ? 9 : 6, K.pot, { line: K.potD });
  const at = P(x, y, z + (big ? 9 : 6));
  const g = big ? PLANT_BIG : PLANT_SMALL;
  R.grid(g, PLANT_PAL, at[0] - Math.floor(g[0]!.length / 2), at[1] - g.length + 1);
}

function chairSeat(c: DrawCtx, x: number, y: number, z: number, face: string) {
  const { R, P } = c;
  box(R, P, x - 0.2, y - 0.2, z + 6, 0.4, 0.4, 2, K.woodL, { line: true });
  box(R, P, x - 0.17, y + 0.14, z, 0.05, 0.05, 6, K.woodD);
  box(R, P, x + 0.13, y + 0.14, z, 0.05, 0.05, 6, K.woodD);
  if (face === 'x+') box(R, P, x - 0.22, y - 0.2, z + 8, 0.06, 0.4, 9, K.woodD, { line: true });
  if (face === 'y+') box(R, P, x - 0.2, y - 0.22, z + 8, 0.4, 0.06, 9, K.woodD, { line: true });
}

/** Backrest on the viewer's side: drawn after whoever sits in the chair. */
export function chairBackFront(c: DrawCtx, x: number, y: number, z: number, face: string) {
  const { R, P } = c;
  if (face === 'x-') box(R, P, x + 0.16, y - 0.2, z + 8, 0.06, 0.4, 9, K.woodD, { line: true });
  if (face === 'y-') box(R, P, x - 0.2, y + 0.16, z + 8, 0.4, 0.06, 9, K.woodD, { line: true });
}

function candle(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P, t } = c;
  box(R, P, x - 0.04, y - 0.04, z, 0.08, 0.08, 3, K.cream);
  const f = P(x, y, z + 4);
  R.px(f[0], f[1] - (Math.floor(t * 5) % 2), '#ffcf6a', 1, true);
  c.lights.push({ x: f[0], y: f[1] + 4, r: 18, col: [1, 0.75, 0.4], s: 0.9 });
}

function roundTable(c: DrawCtx, x: number, y: number, z: number, seed: number) {
  const { R, P, t } = c;
  box(R, P, x - 0.06, y - 0.06, z, 0.12, 0.12, 11, K.woodD);
  disc(R, P, x, y, 0.5, z + 10, K.woodD);
  disc(R, P, x, y, 0.5, z + 12, K.woodL);
  box(R, P, x - 0.2, y - 0.05, z + 12, 0.14, 0.14, 3, K.white, { line: K.metalD });
  const m = P(x - 0.13, y + 0.02, z + 16);
  const f = Math.floor(t * 3 + seed) % 3;
  R.px(m[0] + (f === 0 ? 0 : 1), m[1] - 1, '#ffffff', 0.6);
  R.px(m[0] + (f === 1 ? 1 : 0), m[1] - 3, '#ffffff', 0.4);
  box(R, P, x + 0.08, y - 0.12, z + 12, 0.2, 0.26, 1, '#f0d7a8');
  box(R, P, x + 0.12, y - 0.06, z + 13, 0.12, 0.12, 2, '#c47a3a');
  if (c.theme === 'night') candle(c, x + 0.15, y + 0.15, z + 12);
}

function espresso(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x, y, z, 0.8, 0.5, 12, K.metal, { top: '#dfe4e8', line: K.metalD });
  box(R, P, x + 0.1, y + 0.5, z + 5, 0.6, 0.06, 3, K.ink);
  box(R, P, x + 0.15, y + 0.35, z + 12, 0.5, 0.2, 2, '#c24a3a');
  const l = P(x + 0.7, y + 0.5, z + 10);
  R.px(l[0], l[1], '#ff5a4a', 1, true);
}

function register(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x, y, z, 0.5, 0.45, 5, '#3c3f44', { line: K.ink });
  box(R, P, x + 0.05, y + 0.05, z + 5, 0.4, 0.1, 5, '#2b2e33');
  const s = P(x + 0.1, y + 0.15, z + 9);
  R.rect(s[0], s[1], 4, 2, K.screen, 1, true);
}

function displayCase(c: DrawCtx, x: number, y: number, z: number, w: number) {
  const { R, P } = c;
  box(R, P, x, y, z, w, 0.7, 11, '#e9dcc3', { line: true, top: '#f3e9d5' });
  const gz = z + 11;
  const cols = ['#d9923f', '#b8643a', '#f0c3cf', '#e8c170', '#7a4a2a'];
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < Math.floor(w / 0.22); i++) {
      box(R, P, x + 0.1 + i * 0.22, y + 0.15 + row * 0.3, gz + (row === 0 ? 6 : 1), 0.14, 0.14, 2, cols[(i + row * 2) % 5]!);
    }
  }
  box(R, P, x, y, gz, w, 0.7, 12, '#cfeef2', { a: 0.28, top: '#e8f8fa' });
  const e1 = P(x, y + 0.7, gz + 12), e2 = P(x + w, y + 0.7, gz + 12), e3 = P(x + w, y, gz + 12);
  R.line(e1[0], e1[1], e2[0], e2[1], '#ffffff', 0.7);
  R.line(e2[0], e2[1], e3[0], e3[1], '#ffffff', 0.5);
}

function rugRect(c: DrawCtx, x: number, y: number, w: number, d: number, z: number) {
  const { R, P } = c;
  quad(R, P, x, y, w, d, z + 0.1, K.rugD);
  quad(R, P, x + 0.12, y + 0.12, w - 0.24, d - 0.24, z + 0.1, K.rug);
  quad(R, P, x + 0.35, y + 0.35, w - 0.7, d - 0.7, z + 0.1, K.rugL);
  quad(R, P, x + 0.55, y + 0.55, w - 1.1, d - 1.1, z + 0.1, K.rug);
}

const BOOKS = ['#b5483f', '#4f7fae', '#e0a84a', '#5c8f5a', '#8a6fb8', '#efe0c0', '#3f5f6b', '#c77d4f'];

function shelfUnit(c: DrawCtx, p: Prop, z: number, archive: boolean) {
  const { R, P } = c;
  const h = p.opts?.h ?? 40;
  const againstLeft = p.face === 'x+';
  box(R, P, p.x, p.y, z, p.w, p.d, h, archive ? K.wood : K.woodD, { line: true });
  const face: Plane = againstLeft ? { x: p.x + p.w } : { y: p.y + p.d };
  const a0 = againstLeft ? p.y : p.x;
  const a1 = againstLeft ? p.y + p.d : p.x + p.w;
  const shelves = Math.floor((h - 4) / 10);
  for (let s = 0; s < shelves; s++) {
    const v0 = z + 3 + s * 10;
    if (archive) {
      const n = Math.max(1, Math.floor((a1 - a0) / 0.34));
      for (let i = 0; i < n; i++) {
        const u = a0 + 0.06 + i * 0.34;
        plane(R, P, face, u, u + 0.28, v0, v0 + 7, hash(i + s * 13) > 0.5 ? '#c9a06a' : '#b98d58');
        plane(R, P, face, u + 0.09, u + 0.19, v0 + 3, v0 + 4, K.cream);
      }
      continue;
    }
    plane(R, P, face, a0 + 0.05, a1 - 0.05, v0 - 1, v0, K.wood);
    let u = a0 + 0.08;
    let i = 0;
    while (u < a1 - 0.12) {
      const r = hash(Math.round(a0 * 97) + s * 31 + i * 7 + (againstLeft ? 5 : 11));
      const w = 0.07 + r * 0.06;
      if (r > 0.86) { u += 0.12; i++; continue; }
      plane(R, P, face, u, Math.min(u + w, a1 - 0.08), v0, v0 + 6 + Math.round(r * 2), BOOKS[Math.floor(r * BOOKS.length)]!);
      u += w + 0.015;
      i++;
    }
  }
  if (p.opts?.plantOnTop) plantPot(c, p.x + p.w / 2, p.y + p.d / 2, z + h, false);
}

function desk(c: DrawCtx, p: Prop, z: number) {
  const { R, P } = c;
  const { x, y, w } = p;
  box(R, P, x, y, z, 0.08, 0.7, 12, K.woodD);
  box(R, P, x + w - 0.08, y, z, 0.08, 0.7, 12, K.woodD);
  box(R, P, x, y, z + 12, w, 0.7, 2, K.woodL, { line: true });
  // The monitor faces the agent sitting behind the desk; we see its back.
  box(R, P, x + w / 2 - 0.35, y + 0.12, z + 14, 0.7, 0.08, 9, '#3a3f47', { line: K.ink });
  box(R, P, x + w / 2 - 0.05, y + 0.2, z + 14, 0.1, 0.1, 2, K.metalD);
  const glow = P(x + w / 2 - 0.35, y + 0.12, z + 23);
  R.line(glow[0], glow[1], glow[0] + 8, glow[1] - 4, K.screen, 0.9, true);
  box(R, P, x + 0.6, y + 0.02, z + 14, 0.55, 0.14, 1, '#2f3338'); // keyboard
  box(R, P, x + w - 0.3, y + 0.45, z + 14, 0.12, 0.12, 3, K.white); // mug
  box(R, P, x + 0.12, y + 0.4, z + 14, 0.3, 0.22, 1, '#f7f1e3'); // papers
  if (p.opts?.lamp) {
    box(R, P, x + 0.1, y + 0.1, z + 14, 0.08, 0.08, 8, K.brass);
    box(R, P, x + 0.02, y + 0.02, z + 21, 0.24, 0.24, 3, K.brass, { top: shade(K.brass, 0.2) });
    const b = P(x + 0.14, y + 0.14, z + 21);
    R.rect(b[0] - 1, b[1], 3, 1, K.bulb, 1, true);
    c.lights.push(warm(b[0], b[1] + 8, 26, 0.8));
  }
}

function floorLamp(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x - 0.1, y - 0.1, z, 0.2, 0.2, 1, K.ink);
  box(R, P, x - 0.03, y - 0.03, z, 0.06, 0.06, 26, K.ink);
  const q = P(x, y, z + 30);
  R.poly([[q[0] - 4, q[1] + 4], [q[0] + 4, q[1] + 4], [q[0] + 2, q[1] - 1], [q[0] - 2, q[1] - 1]], '#f3dfb5');
  R.rect(q[0] - 2, q[1] + 4, 5, 1, K.bulb, 1, true);
  c.lights.push(warm(q[0], q[1] + 10, 40, 0.9));
}

function sideLamp(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x - 0.2, y - 0.2, z, 0.4, 0.4, 10, K.woodD, { line: true });
  box(R, P, x - 0.03, y - 0.03, z + 10, 0.06, 0.06, 5, K.brass);
  const q = P(x, y, z + 18);
  R.poly([[q[0] - 4, q[1] + 3], [q[0] + 4, q[1] + 3], [q[0] + 2, q[1] - 2], [q[0] - 2, q[1] - 2]], '#f3dfb5');
  c.lights.push(warm(q[0], q[1] + 8, 30, 0.8));
}

function pendant(c: DrawCtx, x: number, y: number, zTop: number, zLamp: number) {
  const { R, P } = c;
  const a = P(x, y, zTop), b = P(x, y, zLamp + 4);
  R.line(a[0], a[1], b[0], b[1], K.ink);
  const q = P(x, y, zLamp);
  R.poly([[q[0] - 4, q[1] + 1], [q[0] + 4, q[1] + 1], [q[0] + 2, q[1] - 3], [q[0] - 2, q[1] - 3]], K.teal);
  R.rect(q[0] - 4, q[1], 9, 1, shade(K.teal, -0.3));
  R.rect(q[0] - 1, q[1] + 1, 3, 1, K.bulb, 1, true);
  c.lights.push({ x: q[0], y: q[1] + 10, r: 46, col: [1, 0.82, 0.55], s: 1 });
}

function hangingPlant(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  const a = P(x, y, z), b = P(x, y, z - 5);
  R.line(a[0], a[1], b[0], b[1], '#3a2a22');
  box(R, P, x - 0.12, y - 0.12, z - 9, 0.24, 0.24, 4, K.pot);
  const q = P(x, y, z - 5);
  R.grid(PLANT_HANG, PLANT_PAL, q[0] - 3, q[1] + 1);
}

function coatRack(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x - 0.12, y - 0.12, 0, 0.24, 0.24, 1, K.woodD);
  box(R, P, x - 0.03, y - 0.03, 0, 0.06, 0.06, 30, K.woodD);
  const top = P(x, y, 30);
  R.rect(top[0] - 4, top[1] + 1, 9, 1, K.woodD);
  R.poly([[top[0] - 5, top[1] + 2], [top[0] - 1, top[1] + 2], [top[0] - 2, top[1] + 14], [top[0] - 6, top[1] + 13]], '#6b4a6e');
  if (c.theme === 'snow') { R.rect(top[0] + 1, top[1] + 2, 3, 9, K.coral); R.rect(top[0] + 1, top[1] + 10, 4, 2, K.coral); }
}

function umbrellas(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x - 0.14, y - 0.14, 0, 0.28, 0.28, 8, '#5b6b78', { line: true });
  const b = P(x, y, 8);
  R.line(b[0] - 1, b[1], b[0] - 4, b[1] - 14, K.berry);
  R.poly([[b[0] - 6, b[1] - 12], [b[0] - 2, b[1] - 16], [b[0] - 3, b[1] - 8]], K.berry);
  R.line(b[0] + 1, b[1], b[0] + 3, b[1] - 12, K.teal);
  R.poly([[b[0] + 1, b[1] - 10], [b[0] + 5, b[1] - 14], [b[0] + 5, b[1] - 6]], K.teal);
}

function standFan(c: DrawCtx, x: number, y: number) {
  const { R, P, t } = c;
  box(R, P, x - 0.15, y - 0.15, 0, 0.3, 0.3, 1, K.metalD);
  box(R, P, x - 0.03, y - 0.03, 0, 0.06, 0.06, 20, K.metalD);
  const q = P(x, y, 26);
  R.rect(q[0] - 4, q[1] - 4, 9, 9, K.metal);
  R.rect(q[0] - 3, q[1] - 3, 7, 7, '#dfe4e8');
  if (Math.floor(t * 12) % 2) { R.line(q[0] - 3, q[1], q[0] + 3, q[1], K.metalD); R.line(q[0], q[1] - 3, q[0], q[1] + 3, K.metalD); }
  else { R.line(q[0] - 2, q[1] - 2, q[0] + 2, q[1] + 2, K.metalD); R.line(q[0] - 2, q[1] + 2, q[0] + 2, q[1] - 2, K.metalD); }
}

function aframe(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  plane(R, P, { x }, y, y + 0.7, 2, 16, K.woodD);
  plane(R, P, { x }, y + 0.06, y + 0.64, 4, 14, '#29352f');
  for (let i = 0; i < 3; i++) {
    const a = planePt(P, { x }, y + 0.15, 11 - i * 3), b = planePt(P, { x }, y + 0.55 - i * 0.08, 11 - i * 3);
    R.line(a[0], a[1], b[0], b[1], '#f1eadb', 0.7);
  }
  box(R, P, x - 0.02, y + 0.05, 0, 0.04, 0.04, 3, K.woodD);
  box(R, P, x - 0.02, y + 0.61, 0, 0.04, 0.04, 3, K.woodD);
}

function stool(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x - 0.04, y - 0.04, 0, 0.08, 0.08, 13, K.woodD);
  disc(R, P, x, y, 0.22, 13, K.woodD);
  disc(R, P, x, y, 0.22, 15, K.woodL);
}

function coffeeStation(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x, y, z, 0.65, 0.5, 14, K.woodL, { line: true });
  box(R, P, x + 0.08, y + 0.05, z + 14, 0.3, 0.3, 8, '#3b3f45', { line: K.ink });
  box(R, P, x + 0.12, y + 0.3, z + 14, 0.14, 0.12, 3, '#9fd0ea', { a: 0.7 });
  box(R, P, x + 0.45, y + 0.1, z + 14, 0.12, 0.12, 3, K.berry);
  box(R, P, x + 0.45, y + 0.3, z + 14, 0.12, 0.12, 3, K.cream);
}

/** A stairwell opening: the stairs run hidden under the floor; steps drop away from the open side. */
function stairwell(c: DrawCtx, p: Prop, z: number) {
  const { R, P } = c;
  const { x, y, w, d } = p;
  quad(R, P, x - 0.06, y - 0.06, w + 0.12, d + 0.12, z + 0.1, K.woodD);
  quad(R, P, x, y, w, d, z + 0.1, '#23170f');
  const n = 5, run = 0.3;
  for (let i = 0; i < n; i++) {
    const x1 = x + w - i * run, xa = x1 - run * 0.8;
    quad(R, P, xa, y + 0.08, x1 - xa, d - 0.16, z + 0.1, mix(K.plankL, '#23170f', i / n));
    const e0 = P(xa, y + d - 0.08, z + 0.1), e1 = P(xa, y + 0.08, z + 0.1);
    R.line(e0[0], e0[1], e1[0], e1[1], mix(K.woodD, '#1a100a', i / n));
  }
}

// ── composites ──────────────────────────────────────────────────────────────

function cafeCounter(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  const { x, y, w, d } = p;
  box(R, P, x, y, 0, w, d, 16, K.wood, { line: true });
  for (let u = x + 0.25; u < x + w - 0.1; u += 0.3) {
    const p0 = P(u, y + d, 2), p1 = P(u, y + d, 13);
    R.line(p0[0], p0[1], p1[0], p1[1], K.woodD, 0.6);
  }
  box(R, P, x - 0.1, y - 0.05, 16, w + 0.2, d + 0.1, 2, K.counterTop, { line: K.woodD });
  espresso(c, x + 0.1, y + 0.1, 18);
  displayCase(c, x + 1.1, y + 0.05, 18, 1.9);
  register(c, x + 3.2, y + 0.2, 18);
  for (let i = 0; i < 3; i++) box(R, P, x + 3.85, y + 0.15 + i * 0.18, 18, 0.14, 0.14, 3 + i, K.white);
}

function backbar(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  box(R, P, p.x, p.y, 0, p.w, p.d, 16, K.woodD, { line: true, top: K.counterTop });
  box(R, P, p.x + 0.3, p.y + 0.1, 16, 0.5, 0.35, 8, '#3b3f45'); // grinder
  for (let i = 0; i < 4; i++) {
    const x = p.x + 1.8 + i * 0.34;
    box(R, P, x, p.y + 0.12, 16, 0.24, 0.2, 7, i % 2 ? '#8b5a2b' : '#6e4524', { line: true });
    const l = P(x + 0.04, p.y + 0.32, 20);
    R.rect(l[0], l[1], 3, 2, K.cream);
  }
}

function sofa(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  box(R, P, p.x, p.y, 0, p.w, p.d, 7, K.teal, { line: true });
  box(R, P, p.x, p.y, 7, 0.2, p.d, 8, shade(K.teal, -0.1), { line: true });
  box(R, P, p.x + 0.2, p.y + 0.3, 7, 0.3, 0.45, 4, K.amber, { line: true });
  box(R, P, p.x + 0.2, p.y + p.d - 0.75, 7, 0.3, 0.45, 4, K.berry, { line: true });
  const cat = P(p.x + 0.4, p.y + p.d / 2 + 0.1, 7);
  R.grid(CAT_LOAF, CAT_PAL, cat[0] - 5, cat[1] - 6);
}

function armchair(c: DrawCtx, p: Prop, z: number) {
  const { R, P } = c;
  const col = '#c46b4e';
  box(R, P, p.x, p.y, z, 0.8, 0.8, 7, col, { line: true });
  if (p.face === 'x-') {
    // Sitter faces the sofa: backrest on the far (+x) side, arms front and back.
    box(R, P, p.x + 0.62, p.y, z + 7, 0.18, 0.8, 9, shade(col, -0.12), { line: true });
    box(R, P, p.x, p.y, z + 7, 0.62, 0.14, 4, shade(col, -0.05), { line: true });
    box(R, P, p.x, p.y + 0.66, z + 7, 0.62, 0.14, 4, shade(col, -0.05), { line: true });
  } else {
    box(R, P, p.x, p.y, z + 7, 0.18, 0.8, 9, shade(col, -0.12), { line: true });
    box(R, P, p.x + 0.18, p.y, z + 7, 0.62, 0.14, 4, shade(col, -0.05), { line: true });
  }
}

function coffeeTable(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  box(R, P, p.x, p.y, 0, p.w, p.d, 7, K.woodD, { line: true, top: K.woodL });
  box(R, P, p.x + 0.15, p.y + 0.2, 7, 0.3, 0.4, 2, '#e8dcc0'); // magazines
  box(R, P, p.x + 0.2, p.y + 0.3, 9, 0.25, 0.3, 1, K.teal);
  box(R, P, p.x + 0.55, p.y + 0.75, 7, 0.14, 0.14, 3, K.white, { line: K.metalD }); // mug
  plantPot(c, p.x + 0.55, p.y + 0.3, 7, false);
}

function workBar(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  box(R, P, p.x + 0.1, p.y + 0.1, 0, 0.1, p.d - 0.2, 14, K.woodD);
  box(R, P, p.x + p.w - 0.2, p.y + 0.1, 0, 0.1, p.d - 0.2, 14, K.woodD);
  box(R, P, p.x, p.y, 14, p.w, p.d, 2, K.woodL, { line: true, top: K.counterTop });
  // Laptops open toward the stools on the front side.
  for (const lx of [0.25, 1.2, 2.15]) {
    box(R, P, p.x + lx, p.y + 0.2, 16, 0.5, 0.35, 1, K.metal);
    box(R, P, p.x + lx, p.y + 0.18, 17, 0.5, 0.05, 7, K.metalD, { top: K.metal });
    const g = P(p.x + lx + 0.1, p.y + 0.23, 22);
    R.rect(g[0], g[1], 3, 2, K.screen, 1, true);
  }
  box(R, P, p.x + 2.75, p.y + 0.45, 16, 0.12, 0.12, 3, K.white);
}

function barStool(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x - 0.04, y - 0.04, 0, 0.08, 0.08, 11, K.ink);
  disc(R, P, x, y, 0.2, 11, K.ink);
  disc(R, P, x, y, 0.2, 12, '#c46b4e');
}

function cabinet(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  box(R, P, p.x, p.y, 0, p.w, p.d, 24, K.metal, { line: K.metalD, top: '#dde2e6' });
  for (let i = 0; i < 3; i++) {
    const a = P(p.x, p.y + p.d, 4 + i * 7), b = P(p.x + p.w, p.y + p.d, 4 + i * 7);
    R.line(a[0], a[1], b[0], b[1], K.metalD);
  }
  box(R, P, p.x + 0.15, p.y + 0.1, 24, 0.3, 0.3, 5, K.pot);
}

/** Draw one floor prop. Returns false for props this theme hides (umbrellas in dry weather…). */
export function drawProp(c: DrawCtx, p: Prop, z: number, ceiling: number): void {
  const { R, P } = c;
  const cx = p.x + p.w / 2, cy = p.y + p.d / 2;
  switch (p.kind) {
    case 'backbar': return backbar(c, p);
    case 'cafeCounter': return cafeCounter(c, p);
    case 'bookshelf': return shelfUnit(c, p, z, false);
    case 'archive': return shelfUnit(c, p, z, true);
    case 'cabinet': return cabinet(c, p);
    case 'windowBar': return box(R, P, p.x, p.y, 20, p.w, p.d, 2, K.woodL, { line: true });
    case 'stool': return stool(c, cx, cy);
    case 'coatRack': return coatRack(c, cx, cy);
    case 'umbrellas': if (c.theme === 'rain') umbrellas(c, cx, cy); return;
    case 'doormat': return quad(R, P, p.x, p.y, p.w, p.d, z + 0.1, '#6b4a3a');
    case 'aframe': return aframe(c, p.x, p.y);
    case 'roundTable': return roundTable(c, cx, cy, z, cx + cy);
    case 'chair': return chairSeat(c, cx, cy, z, p.face ?? 'x+');
    case 'plant': return plantPot(c, cx, cy, z, false);
    case 'bigPlant': return plantPot(c, cx, cy, z, true);
    case 'fan': if (c.theme === 'summer') standFan(c, cx, cy); return;
    case 'rug': return rugRect(c, p.x, p.y, p.w, p.d, z);
    case 'sofa': return sofa(c, p);
    case 'sideLamp': return sideLamp(c, cx, cy, z);
    case 'armchair': return armchair(c, p, z);
    case 'pendant': return pendant(c, p.x, p.y, ceiling, ceiling - 18);
    case 'hangingPlant': return hangingPlant(c, p.x, p.y, ceiling - 6);
    case 'desk': return desk(c, p, z);
    case 'coffeeStation': return coffeeStation(c, p.x, p.y, z);
    case 'floorLamp': return floorLamp(c, cx, cy, z);
    case 'stairwell': return stairwell(c, p, z);
    case 'coffeeTable': return coffeeTable(c, p);
    case 'workBar': return workBar(c, p);
    case 'barStool': return barStool(c, cx, cy);
    default: return drawOutdoor(c, p);
  }
}

// ── wall decor ──────────────────────────────────────────────────────────────

export function windowPane(c: DrawCtx, pl: Plane, a0: number, a1: number, v0: number, v1: number) {
  const { R, P, t, theme } = c;
  const TH = THEMES[theme];
  plane(R, P, pl, a0 - 0.12, a1 + 0.12, v0 - 3, v1 + 3, K.woodD);
  for (let v = v0; v < v1; v++) plane(R, P, pl, a0, a1, v, v + 1, mix(TH.sky[1], TH.sky[0], (v - v0) / Math.max(1, v1 - v0)), 1, true);
  const span = a1 - a0, hgt = v1 - v0;
  if (theme === 'day' || theme === 'summer') {
    for (let i = 0; i < 2; i++) {
      const u = a0 + ((hash(i + 3) * span + t * 0.05) % span);
      const q = planePt(P, pl, u, v0 + hgt * (0.55 + 0.25 * hash(i + 9)));
      R.rect(q[0] - 4, q[1], 9, 2, '#ffffff', 0.9, true);
      R.rect(q[0] - 2, q[1] - 1, 5, 1, '#ffffff', 0.9, true);
    }
    if (theme === 'summer') { const q = planePt(P, pl, a0 + span * 0.75, v0 + hgt * 0.8); R.rect(q[0] - 2, q[1] - 2, 5, 5, '#fff3b0', 1, true); }
  }
  if (theme === 'night') {
    for (let i = 0; i < 10; i++) { const q = planePt(P, pl, a0 + hash(i * 3 + 1) * span, v0 + hgt * (0.3 + 0.7 * hash(i * 5 + 2))); R.px(q[0], q[1], '#fff6d0', 0.5 + 0.5 * Math.sin(t * 2 + i), true); }
    const m = planePt(P, pl, a0 + span * 0.3, v0 + hgt * 0.78);
    R.rect(m[0] - 2, m[1] - 2, 4, 4, '#f4ecc8', 1, true);
    R.rect(m[0], m[1] - 2, 2, 2, TH.sky[0], 1, true);
  }
  if (theme === 'rain') {
    for (let i = 0; i < 14; i++) {
      const q = planePt(P, pl, a0 + hash(i * 7 + 5) * span, v1 - ((t * 30 + hash(i * 11) * hgt) % hgt));
      R.line(q[0], q[1], q[0], q[1] + 3, '#dfe9f2', 0.7, true);
    }
  }
  if (theme === 'snow') {
    for (let i = 0; i < 14; i++) {
      const q = planePt(P, pl, a0 + ((hash(i * 7 + 5) * span + Math.sin(t + i) * 0.1 + span) % span), v1 - ((t * 6 + hash(i * 11) * hgt) % hgt));
      R.px(q[0], q[1], '#ffffff', 1, true);
    }
    plane(R, P, pl, a0, a1, v0, v0 + 2, '#ffffff', 1, true);
  }
  const mid = (a0 + a1) / 2;
  plane(R, P, pl, mid - 0.04, mid + 0.04, v0, v1, K.woodD);
  plane(R, P, pl, a0, a1, (v0 + v1) / 2 - 1, (v0 + v1) / 2, K.woodD);
  const s0 = planePt(P, pl, a0 + span * 0.15, v1 - 3), s1 = planePt(P, pl, a0 + span * 0.3, v0 + 3);
  R.line(s0[0], s0[1], s1[0], s1[1], '#ffffff', 0.25, true);
  // Sill.
  if (pl.x !== undefined) box(R, P, pl.x, a0 - 0.1, v0 - 5, 0.25, a1 - a0 + 0.2, 2, K.woodL);
  else box(R, P, a0 - 0.1, pl.y!, v0 - 5, a1 - a0 + 0.2, 0.25, 2, K.woodL);
}

function sconce(c: DrawCtx, pl: Plane, u: number, v: number) {
  const { R, P } = c;
  const q = planePt(P, pl, u, v);
  R.rect(q[0] - 1, q[1] - 1, 3, 4, K.brass);
  R.poly([[q[0] - 3, q[1] - 1], [q[0] + 3, q[1] - 1], [q[0] + 2, q[1] - 5], [q[0] - 2, q[1] - 5]], '#f3dfb5');
  R.rect(q[0] - 1, q[1] - 1, 3, 1, K.bulb, 1, true);
  c.lights.push(warm(q[0], q[1] + 6, 30, 0.7));
}

function menuBoard(c: DrawCtx, pl: Plane, a0: number, a1: number, v0: number, v1: number) {
  const { R, P } = c;
  plane(R, P, pl, a0, a1, v0, v1, K.woodD);
  plane(R, P, pl, a0 + 0.08, a1 - 0.08, v0 + 2, v1 - 2, '#29352f');
  const slope = pl.y !== undefined ? 0.5 : -0.5;
  const start = pl.y !== undefined ? planePt(P, pl, a0 + 0.3, v1 - 4) : planePt(P, pl, a1 - 0.3, v1 - 4);
  text(R, 'MENU', start[0], start[1], '#f1eadb', { slope });
  for (let i = 0; i < 3; i++) {
    const aa = planePt(P, pl, a0 + 0.3, v1 - 12 - i * 5), bb = planePt(P, pl, a1 - 0.6, v1 - 12 - i * 5);
    R.line(aa[0], aa[1], bb[0], bb[1], '#f1eadb', 0.5);
    const pr = planePt(P, pl, a1 - 0.35, v1 - 12 - i * 5);
    R.rect(pr[0], pr[1] - 1, 2, 2, K.amber);
  }
}

function mugShelf(c: DrawCtx, pl: Plane, a0: number, a1: number, v: number) {
  const { R, P } = c;
  plane(R, P, pl, a0, a1, v - 2, v, K.wood);
  const cols = ['#e76f51', '#4f9aa5', '#f3e6cc', '#e0a84a', '#8a6fb8', '#6aa35a'];
  for (let i = 0; i < Math.floor((a1 - a0) / 0.28); i++) {
    const u = a0 + 0.12 + i * 0.28;
    if (pl.y !== undefined) box(R, P, u, pl.y + 0.05, v, 0.14, 0.14, 4, cols[i % cols.length]!);
    else box(R, P, pl.x! + 0.05, u, v, 0.14, 0.14, 4, cols[i % cols.length]!);
  }
}

function framed(c: DrawCtx, pl: Plane, a0: number, a1: number, v0: number, v1: number, col: string) {
  const { R, P } = c;
  plane(R, P, pl, a0, a1, v0, v1, K.woodD);
  plane(R, P, pl, a0 + 0.06, a1 - 0.06, v0 + 2, v1 - 2, K.cream);
  plane(R, P, pl, a0 + 0.14, a1 - 0.14, v0 + 4, v1 - 4, col);
}

function kanban(c: DrawCtx, pl: Plane, a0: number, a1: number, v0: number, v1: number) {
  const { R, P } = c;
  plane(R, P, pl, a0, a1, v0, v1, K.metalD);
  plane(R, P, pl, a0 + 0.06, a1 - 0.06, v0 + 2, v1 - 2, '#f7f4ec');
  const cols = 3, w = (a1 - a0 - 0.12) / cols;
  for (let k = 1; k < cols; k++) {
    const u = a0 + 0.06 + k * w;
    const p0 = planePt(P, pl, u, v1 - 3), p1 = planePt(P, pl, u, v0 + 3);
    R.line(p0[0], p0[1], p1[0], p1[1], '#c9c3b5');
  }
  const notes = ['#f2c14e', '#f5a3c0', '#9ee6c9', '#8fb8e8'];
  for (let k = 0; k < cols; k++) {
    for (let r = 0; r < 3 - (k % 2); r++) {
      const q = planePt(P, pl, a0 + 0.14 + k * w + (r % 2) * 0.12, v1 - 7 - r * 6);
      R.rect(q[0], q[1], 3, 3, notes[(k + r) % notes.length]!);
    }
  }
}

function curtains(c: DrawCtx, pl: Plane, a0: number, a1: number, v0: number, v1: number) {
  const { R, P } = c;
  for (const [s0, s1] of [[a0 - 0.36, a0 + 0.02], [a1 - 0.02, a1 + 0.36]] as const) {
    plane(R, P, pl, s0, s1, v0, v1, K.berry);
    for (let u = s0 + 0.09; u < s1; u += 0.12) {
      const p0 = planePt(P, pl, u, v1), p1 = planePt(P, pl, u, v0);
      R.line(p0[0], p0[1], p1[0], p1[1], shade(K.berry, -0.25), 0.8);
    }
  }
  const r0 = planePt(P, pl, a0 - 0.4, v1 + 1), r1 = planePt(P, pl, a1 + 0.4, v1 + 1);
  R.line(r0[0], r0[1], r1[0], r1[1], K.woodD);
}

function bunting(c: DrawCtx, pl: Plane, a0: number, a1: number, v: number) {
  const { R, P } = c;
  const cols = [K.berry, K.amber, K.teal, K.cream, K.leaf];
  const n = Math.floor((a1 - a0) / 0.35);
  for (let i = 0; i < n; i++) {
    const u = a0 + i * 0.35;
    const p = planePt(P, pl, u, v - Math.sin(((i + 0.5) / n) * Math.PI) * 3), q = planePt(P, pl, u + 0.3, v - Math.sin(((i + 1) / n) * Math.PI) * 3);
    R.line(p[0], p[1], q[0], q[1], '#3a2a22', 0.8);
    R.poly([[p[0] + 1, p[1] + 1], [q[0] - 1, q[1] + 1], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 5]], cols[i % cols.length]!);
  }
}

/** Cork board with pinned notes: where agents read and leave notes. */
function noticeBoard(c: DrawCtx, pl: Plane, a0: number, a1: number, v0: number, v1: number) {
  const { R, P } = c;
  plane(R, P, pl, a0, a1, v0, v1, K.woodD);
  plane(R, P, pl, a0 + 0.08, a1 - 0.08, v0 + 2, v1 - 2, '#c08b58');
  const notes = ['#fbf6ec', '#f2c14e', '#f5a3c0', '#9ee6c9', '#fbf6ec', '#8fb8e8'];
  let i = 0;
  for (let u = a0 + 0.2; u < a1 - 0.25; u += 0.34) {
    for (let v = v1 - 8; v > v0 + 3; v -= 8) {
      const q = planePt(P, pl, u + (i % 2) * 0.05, v);
      R.rect(q[0] - 2, q[1], 5, 5, notes[i % notes.length]!);
      R.px(q[0], q[1], K.berry);
      R.rect(q[0] - 1, q[1] + 2, 3, 1, '#9a8a74', 0.8);
      i++;
    }
  }
}

export function drawDecor(c: DrawCtx, d: Decor): void {
  const { R, P } = c;
  const pl: Plane = d.wall === 'L' ? { x: 0 } : { y: 0 };
  switch (d.kind) {
    case 'window': return windowPane(c, pl, d.a0, d.a1, d.v0, d.v1);
    case 'door':
      plane(R, P, pl, d.a0, d.a1, d.v0, d.v1, K.woodD);
      plane(R, P, pl, d.a0 + 0.1, d.a1 - 0.1, d.v0 + 1, d.v1 - 1, K.wood);
      plane(R, P, pl, d.a0 + 0.25, d.a1 - 0.15, d.v1 - 14, d.v1 - 4, THEMES[c.theme].sky[0], 1, true);
      return;
    case 'menu': return menuBoard(c, pl, d.a0, d.a1, d.v0, d.v1);
    case 'mugShelf': return mugShelf(c, pl, d.a0, d.a1, d.v0);
    case 'sconce': return sconce(c, pl, d.a0, d.v0);
    case 'clock': { const q = planePt(P, pl, d.a0, d.v0); R.grid(CLOCK, CLOCK_PAL, q[0] - 4, q[1] - 4); return; }
    case 'framed': return framed(c, pl, d.a0, d.a1, d.v0, d.v1, d.color ?? K.teal);
    case 'kanban': return kanban(c, pl, d.a0, d.a1, d.v0, d.v1);
    case 'curtains': return curtains(c, pl, d.a0, d.a1, d.v0, d.v1);
    case 'bunting': return bunting(c, pl, d.a0, d.a1, d.v0);
    case 'wallPlant': { const q = planePt(P, pl, d.a0, d.v0); R.grid(PLANT_HANG, PLANT_PAL, q[0] - 3, q[1]); return; }
    case 'noticeBoard': return noticeBoard(c, pl, d.a0, d.a1, d.v0, d.v1);
  }
}

// ── building shell ──────────────────────────────────────────────────────────

export function floorTiles(c: DrawCtx, w: number, d: number, z: number, style: 'checker' | 'planks') {
  const { R, P } = c;
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < d; y++) {
      if (style === 'checker') quad(R, P, x, y, 1, 1, z, (x + y) % 2 ? K.cocoa : K.creamTile);
      else for (let h = 0; h < 2; h++) {
        const r = hash((x >> 1) * 7 + (y * 2 + h) * 131 + 17);
        quad(R, P, x, y + h * 0.5, 1, 0.5, z, r < 0.33 ? K.plankD : r < 0.66 ? K.plank : K.plankL);
      }
    }
  }
}

export function wallRun(c: DrawCtx, side: 'L' | 'R', a0: number, a1: number, z0: number, z1: number, upper: boolean) {
  const { R, P } = c;
  const pl: Plane = side === 'L' ? { x: 0 } : { y: 0 };
  const base = upper ? (side === 'L' ? K.sageShade : K.sage) : side === 'L' ? K.plasterShade : K.plaster;
  plane(R, P, pl, a0, a1, z0, z1, base);
  if (!upper) {
    plane(R, P, pl, a0, a1, z0, z0 + 16, side === 'L' ? K.wainsDark : K.wains);
    for (let u = a0 + 0.25; u < a1; u += 0.25) {
      const p0 = planePt(P, pl, u, z0 + 1), p1 = planePt(P, pl, u, z0 + 15);
      R.line(p0[0], p0[1], p1[0], p1[1], K.wainsDark, 0.5);
    }
    plane(R, P, pl, a0, a1, z0 + 16, z0 + 18, K.trim);
  } else {
    plane(R, P, pl, a0, a1, z0, z0 + 3, K.trim);
  }
}

export function wallCap(c: DrawCtx, side: 'L' | 'R', a0: number, a1: number, z: number, cutTo: number) {
  const { R, P, theme } = c;
  const T = 0.28;
  const top = theme === 'snow' ? '#ffffff' : K.cap;
  if (side === 'R') {
    R.poly([P(a0 - T, -T, z), P(a1, -T, z), P(a1, 0, z), P(a0, 0, z)], top);
    R.poly([P(a1, -T, z), P(a1, 0, z), P(a1, 0, cutTo), P(a1, -T, cutTo)], K.capSide);
  } else {
    R.poly([P(-T, a0 - T, z), P(0, a0, z), P(0, a1, z), P(-T, a1, z)], top);
    R.poly([P(-T, a1, z), P(0, a1, z), P(0, a1, cutTo), P(-T, a1, cutTo)], shade(K.capSide, 0.08));
  }
}

export function railing(c: DrawCtx, x0: number, y0: number, x1: number, y1: number, z: number) {
  const { R, P } = c;
  const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / 0.7));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    box(R, P, x0 + (x1 - x0) * u - 0.04, y0 + (y1 - y0) * u - 0.04, z, 0.08, 0.08, 15, K.ink);
  }
  const w = Math.max(0.06, x1 - x0), d = Math.max(0.06, y1 - y0);
  box(R, P, x0 - 0.03, y0 - 0.03, z + 14, w, d, 2, K.ink);
  box(R, P, x0 - 0.02, y0 - 0.02, z + 7, w, d, 1, K.woodD);
}

export function stringLights(c: DrawCtx, pts: Array<[number, number, number]>, phase: number) {
  const { R, P, t, theme } = c;
  const cols = ['#ffd27a', '#ff9e7a', '#9ee6c9', '#ffe9a8', '#f5a3c0'];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = P(pts[i]![0], pts[i]![1], pts[i]![2]), b = P(pts[i + 1]![0], pts[i + 1]![1], pts[i + 1]![2]);
    const n = 8;
    for (let k = 0; k <= n; k++) {
      const u = k / n;
      const x = a[0] + (b[0] - a[0]) * u, y = a[1] + (b[1] - a[1]) * u + Math.sin(u * Math.PI) * 4;
      if (k < n) {
        const u2 = (k + 1) / n;
        R.line(x, y, a[0] + (b[0] - a[0]) * u2, a[1] + (b[1] - a[1]) * u2 + Math.sin(u2 * Math.PI) * 4, '#3a2a22', 0.8);
      }
      if (k % 2 === 1) {
        R.rect(x, y + 1, 2, 2, cols[(i * 5 + k) % cols.length]!, 0.75 + 0.25 * Math.sin((t + phase) * 2 + i * 1.7 + k), true);
        if (isDim(theme)) c.lights.push({ x, y: y + 6, r: 14, col: [1, 0.85, 0.6], s: 0.45 });
      }
    }
  }
}

export function roofPlanter(c: DrawCtx, x0: number, w: number, z: number) {
  const { R, P } = c;
  box(R, P, x0, -0.25, z, w, 0.4, 5, K.woodL, { line: true });
  for (let i = 0; i < Math.floor(w / 0.58); i++) {
    const q = P(x0 + 0.3 + i * 0.58, -0.05, z + 5);
    R.grid(PLANT_SMALL, { l: i % 2 ? K.leafL : K.leaf, L: K.leafD }, q[0] - 2, q[1] - 3);
  }
}
