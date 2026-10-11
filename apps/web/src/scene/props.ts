/**
 * Draw functions for furniture, wall decor and the building shell.
 * Ported from the approved design mockup; each takes a DrawCtx so theme-aware
 * touches (candles at night, umbrellas in the rain) live next to the prop.
 */
import { BUILDING, type Decor, type DecorSide, type Dir, type Prop } from '@/sim/layout';
import { isDim, THEMES, type Light, type ThemeId } from './atmosphere';
import { text } from './font';
import { box, camera, depth, disc, faceVisible, plane, planePt, quad, type Plane, type Proj } from './iso';
import { hash, K, mix, shade } from './palette';
import type { Raster } from './raster';
import { drawOutdoor } from './outdoor';
import { CLOCK_FACE, CLOCK_PAL, FIG, FIG_PAL, PLANT_HANG, PLANT_PAL, PLANT_SMALL, POTHOS, POTHOS_PAL } from './sprites';

export interface DrawCtx {
  R: Raster;
  P: Proj;
  t: number;
  theme: ThemeId;
  lights: Light[];
}

const warm = (x: number, y: number, r: number, s: number): Light => ({ x, y, r, col: [1, 0.82, 0.55], s });

// ── small pieces ────────────────────────────────────────────────────────────

/** Dark frame wood for chairs; cast iron for table feet and stools. */
const FRAME = '#4a2f22';
const IRON = '#2f3a3f';

// ── seen from any side ──────────────────────────────────────────────────────

const NORMAL: Record<Dir, [number, number]> = { 'x+': [1, 0], 'x-': [-1, 0], 'y+': [0, 1], 'y-': [0, -1] };

/** Does the sitter face us, putting their chair's back on the far side? */
const backIsFar = (face: Dir) => faceVisible(...NORMAL[face]);

/**
 * A composite's parts as [x, y, z, draw]. They're written in the order that's right
 * from today's angle; once the camera turns, they're drawn nearest-last instead.
 */
function sorted(parts: Array<[number, number, number, () => void]>) {
  const key = (p: [number, number, number, () => void]) => depth(p[0], p[1]) + p[2] * 0.05;
  if (camera.a !== 0) parts = [...parts].sort((p, q) => key(p) - key(q));
  for (const p of parts) p[3]();
}

/** The building's four sides: where each starts, which way it runs, its outward normal and its plane. */
export const SIDES: Record<DecorSide, { o: [number, number]; u: [number, number]; n: [number, number]; pl: Plane }> = {
  L: { o: [0, 0], u: [0, 1], n: [-1, 0], pl: { x: 0 } },
  R: { o: [0, 0], u: [1, 0], n: [0, -1], pl: { y: 0 } },
  F: { o: [0, BUILDING.D], u: [1, 0], n: [0, 1], pl: { y: BUILDING.D } },
  E: { o: [BUILDING.W, 0], u: [0, 1], n: [1, 0], pl: { x: BUILDING.W } },
};

/** Does this wall face the way today's left wall does (and so take its darker paint)? */
function leftRole(side: DecorSide): boolean {
  const [ix, iy] = [-SIDES[side].n[0], -SIDES[side].n[1]]; // the inner face's normal
  return ix * camera.c - iy * camera.s > ix * camera.s + iy * camera.c;
}

function plantPot(c: DrawCtx, x: number, y: number, z: number, big: boolean) {
  const { R, P } = c;
  if (!big) {
    box(R, P, x - 0.13, y - 0.13, z, 0.26, 0.26, 5, K.ceramic, { line: K.ceramicD });
    const at = P(x, y, z + 5);
    R.grid(PLANT_SMALL, PLANT_PAL, at[0] - 2, at[1] - PLANT_SMALL.length + 1);
    return;
  }
  // Fiddle-leaf fig in a white ceramic pot with a terracotta band.
  box(R, P, x - 0.2, y - 0.2, z, 0.4, 0.4, 9, K.ceramic, { line: K.ceramicD });
  box(R, P, x - 0.21, y - 0.21, z + 6, 0.42, 0.42, 2, K.pot);
  quad(R, P, x - 0.17, y - 0.17, 0.34, 0.34, z + 9, '#5a3a2a');
  const at = P(x, y, z + 9);
  R.grid(FIG, FIG_PAL, at[0] - Math.floor(FIG[0]!.length / 2), at[1] - FIG.length + 1);
}

/** Cup on a saucer, with optional steam. */
function cup(c: DrawCtx, x: number, y: number, z: number, steam: boolean, seed = 0) {
  const { R, P, t } = c;
  disc(R, P, x, y, 0.13, z, '#e4dccd');
  disc(R, P, x, y, 0.12, z + 0.6, K.white);
  box(R, P, x - 0.06, y - 0.06, z + 1, 0.12, 0.12, 3, K.white, { line: '#a69c8c' });
  const q = P(x, y, z + 4);
  R.px(q[0], q[1], '#6b3f22');
  if (!steam) return;
  const f = Math.floor(t * 3 + seed) % 3;
  R.px(q[0] + (f === 0 ? 0 : 1), q[1] - 2, '#ffffff', 0.7);
  R.px(q[0] + (f === 1 ? 1 : 0), q[1] - 4, '#ffffff', 0.45);
  R.px(q[0] + (f === 2 ? 0 : -1), q[1] - 6, '#ffffff', 0.25);
}

function mug(c: DrawCtx, x: number, y: number, z: number, col: string = K.white) {
  box(c.R, c.P, x - 0.06, y - 0.06, z, 0.12, 0.12, 3, col, { line: '#a69c8c' });
}

function vase(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x - 0.04, y - 0.04, z, 0.08, 0.08, 4, K.glass, { a: 0.85 });
  const q = P(x, y, z + 4);
  R.px(q[0], q[1] - 1, K.leafD); R.px(q[0], q[1] - 2, K.leafD);
  R.px(q[0] - 1, q[1] - 3, '#e0475a'); R.px(q[0], q[1] - 3, '#f07a8a'); R.px(q[0] + 1, q[1] - 2, K.amber);
}

function cupStack(c: DrawCtx, x: number, y: number, z: number, n: number) {
  for (let i = 0; i < n; i++) box(c.R, c.P, x, y, z + i * 2, 0.15, 0.15, 2, i % 2 ? '#efe6d6' : K.white, { line: '#a69c8c' });
}

/** Bentwood café chair: four legs, a cushioned seat, and a curved back behind the sitter. */
function chairSeat(c: DrawCtx, x: number, y: number, z: number, face: Dir) {
  const { R, P } = c;
  for (const [lx, ly] of [[-0.15, -0.15], [0.11, -0.15], [-0.15, 0.11], [0.11, 0.11]] as const) box(R, P, x + lx, y + ly, z, 0.04, 0.04, 7, FRAME);
  disc(R, P, x, y, 0.2, z + 7, FRAME);
  disc(R, P, x, y, 0.19, z + 8, K.rug);
  disc(R, P, x - 0.03, y - 0.03, 0.1, z + 8.5, shade(K.rug, 0.15));
  if (backIsFar(face)) chairBack(c, x, y, z, face);
}

function chairBack(c: DrawCtx, x: number, y: number, z: number, face: Dir) {
  const { R, P } = c;
  const rail = '#7a4a32';
  const alongY = face === 'x+' || face === 'x-';
  const off = face === 'x+' || face === 'y+' ? -0.19 : 0.15;
  if (alongY) {
    for (const s of [-0.15, 0.11]) box(R, P, x + off, y + s, z + 8, 0.04, 0.04, 11, FRAME);
    box(R, P, x + off, y - 0.05, z + 9, 0.04, 0.04, 8, FRAME);
    box(R, P, x + off, y - 0.15, z + 12, 0.04, 0.3, 1, rail);
    box(R, P, x + off - 0.01, y - 0.17, z + 17, 0.06, 0.34, 3, rail, { line: FRAME });
  } else {
    for (const s of [-0.15, 0.11]) box(R, P, x + s, y + off, z + 8, 0.04, 0.04, 11, FRAME);
    box(R, P, x - 0.05, y + off, z + 9, 0.04, 0.04, 8, FRAME);
    box(R, P, x - 0.15, y + off, z + 12, 0.3, 0.04, 1, rail);
    box(R, P, x - 0.17, y + off - 0.01, z + 17, 0.34, 0.06, 3, rail, { line: FRAME });
  }
}

/** Backrest on the viewer's side: drawn after whoever sits in the chair. */
export function chairBackFront(c: DrawCtx, x: number, y: number, z: number, face: Dir) {
  if (!backIsFar(face)) chairBack(c, x, y, z, face);
}

/** Desk chair: five-star base, gas lift, seat and a back behind the sitter. */
function officeChair(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x - 0.22, y - 0.03, z, 0.44, 0.06, 1, IRON);
  box(R, P, x - 0.03, y - 0.22, z, 0.06, 0.44, 1, IRON);
  box(R, P, x - 0.03, y - 0.03, z + 1, 0.06, 0.06, 6, K.metalD);
  disc(R, P, x, y, 0.2, z + 7, '#20242b');
  disc(R, P, x, y, 0.19, z + 8, '#3b4350');
  box(R, P, x - 0.18, y - 0.24, z + 9, 0.36, 0.07, 11, '#3b4350', { line: '#20242b' });
}

function candle(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P, t } = c;
  box(R, P, x - 0.04, y - 0.04, z, 0.08, 0.08, 3, K.cream);
  const f = P(x, y, z + 4);
  R.px(f[0], f[1] - (Math.floor(t * 5) % 2), '#ffcf6a', 1, true);
  c.lights.push({ x: f[0], y: f[1] + 4, r: 18, col: [1, 0.75, 0.4], s: 0.9 });
}

/** Marble bistro table on a cast-iron cross foot. */
function roundTable(c: DrawCtx, x: number, y: number, z: number, seed: number) {
  const { R, P } = c;
  box(R, P, x - 0.3, y - 0.04, z, 0.6, 0.08, 1, IRON);
  box(R, P, x - 0.04, y - 0.3, z, 0.08, 0.6, 1, IRON);
  box(R, P, x - 0.045, y - 0.045, z + 1, 0.09, 0.09, 10, '#3d3a38');
  disc(R, P, x, y, 0.46, z + 11, '#7b6f60');
  disc(R, P, x, y, 0.46, z + 12, '#b9ad9b');
  disc(R, P, x, y, 0.44, z + 13, K.marble);
  const q = P(x, y, z + 13);
  for (const [dx, dy] of [[-6, -1], [-5, 0], [-4, 0], [3, 1], [4, 1], [5, 2], [1, -2]] as const) R.px(q[0] + dx, q[1] + dy, K.vein);
  cup(c, x - 0.14, y + 0.04, z + 13, true, seed);
  if (hash(Math.round(seed * 10)) > 0.5) {
    // A croissant on a plate.
    disc(R, P, x + 0.18, y - 0.04, 0.13, z + 13, K.white);
    box(R, P, x + 0.12, y - 0.08, z + 13, 0.12, 0.08, 2, '#c47a3a', { top: '#d99a52' });
  }
  vase(c, x + 0.06, y - 0.24, z + 13);
  if (isDim(c.theme)) candle(c, x + 0.16, y + 0.2, z + 13);
}

function espresso(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x, y, z, 1.25, 0.5, 2, K.chromeD);
  box(R, P, x + 0.02, y, z + 2, 1.21, 0.48, 11, K.chrome, { line: K.chromeD, top: '#eef1f3' });
  if (faceVisible(0, 1)) espressoFront(c, x, y, z);
  for (let i = 0; i < 4; i++) mug(c, x + 0.22 + i * 0.25, y + 0.22, z + 13, i % 2 ? '#efe6d6' : K.white); // cup warmer
}

function espressoFront(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  plane(R, P, { y: y + 0.48 }, x + 0.05, x + 1.18, z + 9, z + 11, '#c24a3a');
  // Two group heads with portafilters, cups waiting under them.
  for (const gx of [0.25, 0.8]) {
    box(R, P, x + gx, y + 0.42, z + 5, 0.18, 0.12, 3, '#5b636b', { line: K.ink });
    const h0 = P(x + gx + 0.09, y + 0.55, z + 5), h1 = P(x + gx + 0.09, y + 0.85, z + 5);
    R.line(h0[0], h0[1], h1[0], h1[1], K.ink);
    box(R, P, x + gx + 0.02, y + 0.46, z + 2, 0.12, 0.12, 2, K.white);
  }
  const g = P(x + 0.6, y + 0.48, z + 9);
  R.rect(g[0] - 1, g[1] - 1, 3, 3, '#fbf6ec');
  R.px(g[0], g[1], '#c24a3a');
  const w0 = P(x + 1.15, y + 0.5, z + 8), w1 = P(x + 1.25, y + 0.7, z + 3);
  R.line(w0[0], w0[1], w1[0], w1[1], K.chromeD); // steam wand
  steamPuff(c, w1[0], w1[1] - 1, x);
  const l = P(x + 0.1, y + 0.48, z + 10);
  R.px(l[0], l[1], '#ff5a4a', 1, true);
}

function grinder(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x, y, z, 0.32, 0.32, 9, '#3b3f45', { line: K.ink });
  box(R, P, x + 0.04, y + 0.04, z + 9, 0.24, 0.24, 6, '#d5f0f4', { a: 0.5 });
  box(R, P, x + 0.06, y + 0.06, z + 9, 0.2, 0.2, 3, '#5a3520'); // beans
  box(R, P, x + 0.04, y + 0.04, z + 15, 0.24, 0.24, 1, '#2b2e33');
}

function syrups(c: DrawCtx, x: number, y: number, z: number, n: number) {
  const cols = ['#c24a3a', '#e0a84a', '#7a4a2a', '#8fae3a', '#e8b4b8', '#6b8cb8'];
  for (let i = 0; i < n; i++) {
    const col = cols[i % cols.length]!;
    box(c.R, c.P, x + i * 0.17, y, z, 0.11, 0.11, 8, col, { top: shade(col, 0.25) });
    box(c.R, c.P, x + i * 0.17 + 0.03, y + 0.03, z + 8, 0.05, 0.05, 2, K.ink);
  }
}

/** Card terminal on a stand, screen toward the customer. */
function register(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x, y, z, 0.18, 0.18, 4, '#3c3f44');
  box(R, P, x - 0.06, y + 0.1, z + 4, 0.34, 0.06, 6, '#2b2e33', { line: K.ink });
  const s = P(x - 0.02, y + 0.16, z + 9);
  R.rect(s[0], s[1], 4, 3, K.screen, 1, true);
}

function bell(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  const q = P(x, y, z);
  R.rect(q[0] - 2, q[1], 5, 1, '#8d6a2a');
  R.rect(q[0] - 1, q[1] - 2, 3, 2, K.brass);
  R.px(q[0], q[1] - 3, K.bulb);
}

function tipJar(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x - 0.07, y - 0.07, z, 0.14, 0.14, 5, '#cfeef2', { a: 0.6 });
  const q = P(x, y, z + 1);
  R.px(q[0], q[1], K.amber);
  R.px(q[0] - 1, q[1] + 1, '#8fae3a');
}

/** Pastries on two tiers behind glass. */
function displayCase(c: DrawCtx, x: number, y: number, z: number, w: number) {
  const { R, P } = c;
  box(R, P, x, y, z, w, 0.7, 3, '#e9dcc3', { line: true, top: '#f3e9d5' });
  const cols = ['#d9923f', '#b8643a', '#f0c3cf', '#e8c170', '#7a4a2a', '#f5e0a8'];
  for (let row = 0; row < 2; row++) {
    const tz = z + 3 + (row === 0 ? 5 : 0);
    box(R, P, x + 0.05, y + 0.1 + row * 0.3, tz, w - 0.1, 0.22, 0, '#f6efe2');
    for (let i = 0; i < Math.floor((w - 0.1) / 0.2); i++) {
      const col = cols[(i + row * 3) % cols.length]!;
      if ((i + row) % 3 === 2) disc(R, P, x + 0.16 + i * 0.2, y + 0.21 + row * 0.3, 0.07, tz + 1, col);
      else box(R, P, x + 0.1 + i * 0.2, y + 0.14 + row * 0.3, tz, 0.13, 0.13, 2, col, { top: shade(col, 0.2) });
    }
  }
  box(R, P, x, y, z + 3, w, 0.7, 10, '#d5f0f4', { a: 0.26, top: '#eafafc' });
  const e1 = P(x, y + 0.7, z + 13), e2 = P(x + w, y + 0.7, z + 13), e3 = P(x + w, y, z + 13);
  R.line(e1[0], e1[1], e2[0], e2[1], '#ffffff', 0.8);
  R.line(e2[0], e2[1], e3[0], e3[1], '#ffffff', 0.55);
  const g0 = P(x + 0.3, y + 0.7, z + 11), g1 = P(x + 0.6, y + 0.7, z + 5);
  R.line(g0[0], g0[1], g1[0], g1[1], '#ffffff', 0.4); // glint
}

/** A cake on a stand under a glass dome. */
function cakeDome(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x - 0.03, y - 0.03, z, 0.06, 0.06, 3, '#d8d2c6');
  disc(R, P, x, y, 0.24, z + 3, '#e9e2d6');
  disc(R, P, x, y, 0.16, z + 4, '#f0c3cf');
  disc(R, P, x, y, 0.16, z + 7, '#f7d9e0');
  const q = P(x, y, z + 7);
  R.px(q[0], q[1] - 1, '#e0475a');
  const a = P(x, y, z + 14), l = P(x - 0.24, y + 0.24, z + 4), r = P(x + 0.24, y - 0.24, z + 4);
  R.poly([[l[0], l[1]], [l[0] + 1, a[1] + 4], [a[0] - 2, a[1]], [a[0] + 2, a[1]], [r[0] - 1, a[1] + 4], [r[0], l[1]]], '#e6f6f8', 0.3);
  R.rect(a[0] - 1, a[1] - 1, 3, 1, '#c8d0d6');
  R.line(l[0] + 2, l[1] - 3, a[0] - 2, a[1] + 2, '#ffffff', 0.6);
}

function rugRect(c: DrawCtx, x: number, y: number, w: number, d: number, z: number) {
  const { R, P } = c;
  const zz = z + 0.1;
  quad(R, P, x, y, w, d, zz, K.rugD);
  quad(R, P, x + 0.12, y + 0.12, w - 0.24, d - 0.24, zz, K.rug);
  quad(R, P, x + 0.32, y + 0.32, w - 0.64, d - 0.64, zz, K.rugBorder);
  quad(R, P, x + 0.42, y + 0.42, w - 0.84, d - 0.84, zz, shade(K.rug, 0.08));
  // Medallion.
  const cx = x + w / 2, cy = y + d / 2;
  const diamond = (k: number, col: string) => R.poly([P(cx, cy - d * k, zz), P(cx + w * k * 0.8, cy, zz), P(cx, cy + d * k, zz), P(cx - w * k * 0.8, cy, zz)], col);
  diamond(0.28, K.rugBorder);
  diamond(0.18, K.rugD);
  diamond(0.08, K.rugL);
  // Fringe on the near edge.
  for (let u = x + 0.1; u < x + w - 0.05; u += 0.16) {
    const a = P(u, y + d, zz), b = P(u, y + d + 0.1, zz);
    R.line(a[0], a[1], b[0], b[1], K.rugBorder);
  }
}

const BOOKS = ['#b5483f', '#4f7fae', '#e0a84a', '#5c8f5a', '#8a6fb8', '#efe0c0', '#3f5f6b', '#c77d4f'];

function shelfUnit(c: DrawCtx, p: Prop, z: number, archive: boolean) {
  const { R, P } = c;
  const h = p.opts?.h ?? 40;
  const againstLeft = p.face === 'x+';
  const body = archive ? K.wood : K.woodD;
  box(R, P, p.x, p.y, z, p.w, p.d, 3, shade(body, -0.2)); // plinth
  box(R, P, p.x, p.y, z + 3, p.w, p.d, h - 3, body, { line: true });
  const face: Plane = againstLeft ? { x: p.x + p.w } : { y: p.y + p.d };
  const a0 = againstLeft ? p.y : p.x;
  const a1 = againstLeft ? p.y + p.d : p.x + p.w;
  // The open front: back panel, shelves and books. From behind it is plain wood.
  if (faceVisible(againstLeft ? 1 : 0, againstLeft ? 0 : 1)) {
    plane(R, P, face, a0 + 0.06, a1 - 0.06, z + 4, z + h - 2, '#4a2c1a'); // back panel
    const shelves = Math.floor((h - 6) / 10);
    for (let s = 0; s < shelves; s++) {
      const v0 = z + 4 + s * 10;
      plane(R, P, face, a0 + 0.04, a1 - 0.04, v0 - 1, v0, K.woodL);
      if (archive) {
        const n = Math.max(1, Math.floor((a1 - a0) / 0.34));
        for (let i = 0; i < n; i++) {
          const u = a0 + 0.06 + i * 0.34;
          plane(R, P, face, u, u + 0.28, v0, v0 + 7, hash(i + s * 13) > 0.5 ? '#c9a06a' : '#b98d58');
          plane(R, P, face, u + 0.09, u + 0.19, v0 + 3, v0 + 4, K.cream);
        }
        continue;
      }
      let u = a0 + 0.1;
      let i = 0;
      while (u < a1 - 0.15) {
        const r = hash(Math.round(a0 * 97) + s * 31 + i * 7 + (againstLeft ? 5 : 11));
        if (r > 0.9 && u < a1 - 0.5) {
          // A stack lying flat.
          for (let k = 0; k < 3; k++) plane(R, P, face, u, u + 0.32, v0 + k * 2, v0 + k * 2 + 2, BOOKS[(i + k) % BOOKS.length]!);
          u += 0.4;
          i++;
          continue;
        }
        const w = 0.07 + r * 0.05;
        const bh = 6 + Math.round(r * 2);
        plane(R, P, face, u, Math.min(u + w, a1 - 0.1), v0, v0 + bh, BOOKS[Math.floor(r * BOOKS.length)]!);
        const sp = planePt(P, face, u + w / 2, v0 + bh - 2);
        R.px(sp[0], sp[1], K.cream, 0.5); // spine label
        u += w + 0.015;
        i++;
      }
    }
  }
  box(R, P, p.x - 0.04, p.y - 0.04, z + h, p.w + 0.08, p.d + 0.08, 2, shade(body, -0.1), { line: true }); // crown
  if (p.opts?.plantOnTop) {
    const q = P(p.x + p.w / 2, p.y + p.d / 2, z + h + 2);
    R.grid(POTHOS, POTHOS_PAL, q[0] - 3, q[1] - 2);
  }
}

function desk(c: DrawCtx, p: Prop, z: number) {
  const { R, P } = c;
  const { x, y, w } = p;
  // Drawer pedestal on the left, a steel leg on the right.
  box(R, P, x, y, z, 0.5, 0.7, 13, K.woodD, { line: true });
  if (faceVisible(0, 1)) for (const v of [4, 8]) {
    const a = P(x + 0.05, y + 0.7, z + v), b = P(x + 0.45, y + 0.7, z + v);
    R.line(a[0], a[1], b[0], b[1], shade(K.woodD, -0.3));
    const hq = P(x + 0.25, y + 0.7, z + v + 2);
    R.px(hq[0], hq[1], K.brass);
  }
  box(R, P, x + w - 0.08, y + 0.05, z, 0.06, 0.6, 13, IRON);
  box(R, P, x, y, z + 13, w, 0.7, 2, '#c4935e', { line: true, top: '#d2a26a' });
  // The monitor faces the agent behind the desk; we see its back and the glow.
  box(R, P, x + w / 2 - 0.1, y + 0.25, z + 15, 0.2, 0.15, 1, IRON);
  box(R, P, x + w / 2 - 0.03, y + 0.3, z + 16, 0.06, 0.06, 3, IRON);
  box(R, P, x + w / 2 - 0.38, y + 0.25, z + 18, 0.76, 0.07, 8, '#2f3338', { line: K.ink });
  const g = P(x + w / 2 - 0.38, y + 0.25, z + 26);
  R.line(g[0], g[1], g[0] + 9, g[1] - 4, K.screen, 0.9, true);
  c.lights.push({ x: g[0] + 5, y: g[1] + 4, r: 18, col: [0.6, 0.9, 1], s: 0.35 });
  box(R, P, x + 0.55, y + 0.02, z + 15, 0.6, 0.14, 1, '#3a3f47'); // keyboard
  box(R, P, x + 1.25, y + 0.05, z + 15, 0.08, 0.1, 1, '#3a3f47'); // mouse
  mug(c, x + w - 0.3, y + 0.5, z + 15);
  box(R, P, x + 0.1, y + 0.4, z + 15, 0.3, 0.22, 1, '#f7f1e3'); // papers
  if (p.opts?.lamp) {
    box(R, P, x + 0.08, y + 0.08, z + 15, 0.1, 0.1, 1, IRON);
    const b0 = P(x + 0.13, y + 0.13, z + 16), b1 = P(x + 0.13, y + 0.13, z + 24), b2 = P(x + 0.3, y + 0.2, z + 27);
    R.line(b0[0], b0[1], b1[0], b1[1], IRON);
    R.line(b1[0], b1[1], b2[0], b2[1], IRON);
    R.poly([[b2[0] - 2, b2[1] - 1], [b2[0] + 3, b2[1] - 1], [b2[0] + 4, b2[1] + 2], [b2[0] - 3, b2[1] + 2]], K.teal);
    R.rect(b2[0] - 1, b2[1] + 2, 3, 1, K.bulb, 1, true);
    c.lights.push(warm(b2[0], b2[1] + 8, 26, 0.8));
  } else {
    plantPot(c, x + 0.25, y + 0.5, z + 15, false);
  }
}

function floorLamp(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  disc(R, P, x, y, 0.14, z, K.ink);
  box(R, P, x - 0.025, y - 0.025, z, 0.05, 0.05, 28, K.brass);
  const q = P(x, y, z + 32);
  R.poly([[q[0] - 5, q[1] + 4], [q[0] + 5, q[1] + 4], [q[0] + 3, q[1] - 2], [q[0] - 3, q[1] - 2]], '#f3dfb5');
  R.rect(q[0] - 5, q[1] + 4, 11, 1, '#d9c294');
  R.rect(q[0] - 2, q[1] + 5, 5, 1, K.bulb, 1, true);
  c.lights.push(warm(q[0], q[1] + 10, 40, 0.9));
}

function sideLamp(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  box(R, P, x - 0.2, y - 0.2, z, 0.4, 0.4, 11, K.woodD, { line: true });
  box(R, P, x - 0.08, y - 0.08, z + 11, 0.16, 0.16, 4, K.teal, { line: true }); // ceramic base
  box(R, P, x - 0.02, y - 0.02, z + 15, 0.04, 0.04, 3, K.brass);
  const q = P(x, y, z + 21);
  R.poly([[q[0] - 5, q[1] + 3], [q[0] + 5, q[1] + 3], [q[0] + 3, q[1] - 3], [q[0] - 3, q[1] - 3]], '#f3dfb5');
  R.rect(q[0] - 5, q[1] + 3, 11, 1, '#d9c294');
  c.lights.push(warm(q[0], q[1] + 8, 32, 0.9));
}

/** Brass dome pendant. */
function pendant(c: DrawCtx, x: number, y: number, zTop: number, zLamp: number) {
  const { R, P } = c;
  const a = P(x, y, zTop), b = P(x, y, zLamp + 5);
  R.line(a[0], a[1], b[0], b[1], K.ink);
  const q = P(x, y, zLamp);
  R.poly([[q[0] - 5, q[1] + 1], [q[0] + 5, q[1] + 1], [q[0] + 4, q[1] - 2], [q[0] + 2, q[1] - 4], [q[0] - 2, q[1] - 4], [q[0] - 4, q[1] - 2]], K.brass);
  R.rect(q[0] - 1, q[1] - 5, 3, 1, '#8d6a2a');
  R.px(q[0] - 3, q[1] - 2, '#fbe2a0');
  R.px(q[0] - 2, q[1] - 3, '#fbe2a0');
  R.rect(q[0] - 5, q[1] + 1, 11, 1, '#8d6a2a');
  R.rect(q[0] - 2, q[1] + 2, 5, 1, K.bulb, 1, true);
  c.lights.push({ x: q[0], y: q[1] + 12, r: 46, col: [1, 0.82, 0.55], s: 1 });
}

function hangingPlant(c: DrawCtx, x: number, y: number, z: number) {
  const { R, P } = c;
  const a = P(x, y, z), b = P(x, y, z - 5);
  R.line(a[0], a[1], b[0], b[1], '#3a2a22');
  box(R, P, x - 0.12, y - 0.12, z - 9, 0.24, 0.24, 4, K.ceramic, { line: K.ceramicD });
  const q = P(x, y, z - 5);
  R.grid(POTHOS, POTHOS_PAL, q[0] - 3, q[1] + 1);
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
  box(R, P, x, y, z, 0.65, 0.5, 14, '#c4935e', { line: true });
  box(R, P, x + 0.05, y + 0.05, z + 14, 0.32, 0.3, 9, '#3b3f45', { line: K.ink });
  box(R, P, x + 0.09, y + 0.28, z + 14, 0.16, 0.12, 3, '#9fd0ea', { a: 0.7 }); // carafe
  const l = P(x + 0.28, y + 0.35, z + 21);
  R.px(l[0], l[1], '#7ad69a', 1, true);
  cupStack(c, x + 0.44, y + 0.08, z + 14, 3);
  mug(c, x + 0.5, y + 0.38, z + 14, K.berry);
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

/** Front counter: sage slatted front, kickplate, veined marble top. */
function cafeCounter(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  const { x, y, w, d } = p;
  box(R, P, x, y, 0, w, d, 13, K.slat, { line: K.slatD });
  if (faceVisible(0, 1)) {
    for (let u = x + 0.12; u < x + w - 0.05; u += 0.16) {
      const p0 = P(u, y + d, 3), p1 = P(u, y + d, 12);
      R.line(p0[0], p0[1], p1[0], p1[1], K.slatD, 0.75);
    }
    plane(R, P, { y: y + d }, x, x + w, 0, 3, '#4b3a2c');
  } else plane(R, P, { y }, x, x + w, 0, 3, '#4b3a2c');
  box(R, P, x - 0.08, y - 0.06, 13, w + 0.16, d + 0.12, 2, K.marble, { line: '#9b8f7f', top: K.marble });
  for (let i = 0; i < Math.floor((w + d) * 3); i++) {
    const q = P(x + hash(i * 7 + 3) * w, y + hash(i * 13 + 3) * d, 15);
    R.px(q[0], q[1], K.vein);
  }
  // Pickup end on the left, then the till, pastries and a cake.
  bell(c, x + 0.25, y + 0.5, 15);
  cupStack(c, x + 0.45, y + 0.15, 15, 3);
  register(c, x + 1.0, y + 0.25, 15);
  tipJar(c, x + 1.55, y + 0.45, 15);
  displayCase(c, x + 1.85, y + 0.05, 15, 1.6);
  cakeDome(c, x + w - 0.4, y + 0.4, 15);
}

/** Back bar: cabinets with brass pulls, grinder, espresso machine, milk jugs, syrups, cups. */
function backbar(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  const { x, y, w, d } = p;
  box(R, P, x, y, 0, w, d, 16, K.woodD, { line: true });
  if (faceVisible(0, 1)) for (let u = x + 0.05; u < x + w - 0.5; u += 0.92) {
    plane(R, P, { y: y + d }, u + 0.05, u + 0.85, 3, 13, K.wood);
    plane(R, P, { y: y + d }, u + 0.1, u + 0.8, 4, 12, shade(K.wood, -0.08));
    const hq = P(u + 0.75, y + d, 9);
    R.px(hq[0], hq[1], K.brass);
  }
  box(R, P, x - 0.04, y - 0.02, 16, w + 0.08, d + 0.06, 2, K.counterTop, { line: K.woodD });
  grinder(c, x + 0.25, y + 0.12, 18);
  espresso(c, x + 0.75, y + 0.05, 18);
  for (const jx of [2.2, 2.42]) box(R, P, x + jx, y + 0.2, 18, 0.16, 0.16, 4, K.chrome, { line: K.chromeD }); // milk jugs
  syrups(c, x + 2.75, y + 0.2, 18, 4);
  cupStack(c, x + 3.55, y + 0.2, 18, 4);
  cupStack(c, x + 3.8, y + 0.2, 18, 3);
  plantPot(c, x + 4.3, y + 0.3, 18, false);
}

/** Chesterfield against the left wall: rolled arms, button-tufted back, two seat cushions. */
function sofa(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  const { x, y, w, d } = p;
  const col = K.velvet, dk = shade(col, -0.3);
  for (const ly of [0.05, d - 0.15]) for (const lx of [0.05, w - 0.15]) box(R, P, x + lx, y + ly, 0, 0.1, 0.1, 2, K.woodD);
  const seg = (d - 0.44) / 2;
  sorted([
    [x + w / 2, y + 0.11, 2, () => box(R, P, x, y, 2, w, 0.22, 11, col, { line: dk })], // far arm
    [x + w / 2, y + d / 2, 2, () => box(R, P, x, y + 0.22, 2, w, d - 0.44, 6, shade(col, -0.08), { line: dk })],
    [x + 0.1, y + d / 2, 8, () => {
      box(R, P, x, y + 0.22, 8, 0.2, d - 0.44, 10, shade(col, -0.05), { line: dk }); // back
      if (faceVisible(1, 0)) for (const v of [11, 15]) {
        for (let u = y + 0.4; u < y + d - 0.3; u += 0.32) {
          const q = planePt(P, { x: x + 0.2 }, u + (v === 15 ? 0.16 : 0), v);
          R.px(q[0], q[1], dk); // buttons
        }
      }
    }],
    ...[0, 1].map((i): [number, number, number, () => void] => [x + 0.2 + (w - 0.22) / 2, y + 0.24 + i * seg + seg / 2, 8, () => box(R, P, x + 0.2, y + 0.24 + i * seg, 8, w - 0.22, seg - 0.04, 2, shade(col, 0.1), { line: dk })]),
    [x + 0.28, y + 0.56, 10, () => box(R, P, x + 0.22, y + 0.35, 10, 0.12, 0.42, 5, K.mustard, { line: true })],
    [x + 0.28, y + d - 0.64, 10, () => box(R, P, x + 0.22, y + d - 0.85, 10, 0.12, 0.42, 5, '#e8d9bd', { line: true })],
    [x + w / 2, y + d - 0.11, 2, () => {
      box(R, P, x, y + d - 0.22, 2, w, 0.22, 11, col, { line: dk }); // near arm
      const a0 = P(x, y + d - 0.22, 13), a1 = P(x + w, y + d - 0.22, 13);
      R.line(a0[0], a0[1], a1[0], a1[1], shade(col, 0.3));
    }],
  ]);
}

/** Mustard wingback. Facing x− puts the back on the far (+x) side. */
function armchair(c: DrawCtx, p: Prop, z: number) {
  const { R, P } = c;
  const { x, y } = p;
  const col = K.mustard, dk = shade(col, -0.4);
  for (const [lx, ly] of [[0.05, 0.05], [0.65, 0.05], [0.05, 0.65], [0.65, 0.65]] as const) box(R, P, x + lx, y + ly, z, 0.08, 0.08, 2, K.woodD);
  box(R, P, x, y, z + 2, 0.8, 0.8, 6, col, { line: dk });
  const back = p.face === 'x-' ? x + 0.6 : x;
  const seat = p.face === 'x-' ? x : x + 0.2;
  const wing = p.face === 'x-' ? x + 0.42 : x + 0.2;
  sorted([
    [seat + 0.3, y + 0.07, 8, () => box(R, P, seat, y, z + 8, 0.6, 0.15, 5, shade(col, -0.05), { line: dk })], // far arm
    [back + 0.1, y + 0.4, 9, () => box(R, P, back, y, z + 8, 0.2, 0.8, 15, shade(col, -0.12), { line: dk })],
    [wing + 0.09, y + 0.07, 12, () => box(R, P, wing, y, z + 12, 0.18, 0.15, 9, shade(col, -0.08), { line: dk })],
    [seat + 0.3, y + 0.4, 8, () => box(R, P, seat + 0.05, y + 0.15, z + 8, 0.5, 0.5, 2, shade(col, 0.12), { line: dk })], // cushion
    [wing + 0.09, y + 0.72, 12, () => box(R, P, wing, y + 0.65, z + 12, 0.18, 0.15, 9, shade(col, -0.08), { line: dk })],
    [seat + 0.3, y + 0.72, 8, () => box(R, P, seat, y + 0.65, z + 8, 0.6, 0.15, 5, shade(col, -0.05), { line: dk })], // near arm
  ]);
}

/** Low table with a shelf of books underneath. */
function coffeeTable(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  const { x, y, w, d } = p;
  for (const [lx, ly] of [[0.05, 0.05], [w - 0.13, 0.05], [0.05, d - 0.13], [w - 0.13, d - 0.13]] as const) box(R, P, x + lx, y + ly, 0, 0.08, 0.08, 6, K.woodD);
  box(R, P, x + 0.05, y + 0.05, 2, w - 0.1, d - 0.1, 1, K.wood);
  box(R, P, x + 0.15, y + 0.2, 3, 0.35, 0.28, 2, K.teal);
  box(R, P, x + 0.18, y + 0.24, 5, 0.3, 0.22, 1, '#e8d9bd');
  box(R, P, x, y, 6, w, d, 2, K.woodL, { line: true, top: '#b5774a' });
  box(R, P, x + 0.1, y + 0.72, 8, 0.45, 0.4, 1, '#7a5a3a'); // tray
  cup(c, x + 0.3, y + 0.92, 9, true, 2);
  box(R, P, x + 0.15, y + 0.12, 8, 0.32, 0.24, 1, '#e8dcc0'); // magazine
  plantPot(c, x + 0.6, y + 0.35, 8, false);
}

/** A high coffee bar on iron legs with a brass foot rail, under the pendant lamps. */
function workBar(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  const { x, y, w, d } = p;
  for (const lx of [0.15, w - 0.25]) {
    box(R, P, x + lx, y + 0.15, 0, 0.1, d - 0.3, 1, IRON);
    box(R, P, x + lx + 0.03, y + d / 2 - 0.04, 1, 0.06, 0.08, 13, IRON);
  }
  box(R, P, x + 0.1, y + d - 0.06, 4, w - 0.2, 0.04, 1, K.brass);
  box(R, P, x, y, 14, w, d, 2, K.woodL, { line: K.woodD, top: '#c08552' });
  // Cups, a sugar jar and a little plant: a coffee bar, not a desk.
  cup(c, x + 0.4, y + 0.35, 16, true, 1);
  mug(c, x + 1.35, y + 0.35, 16, '#e8b4b8');
  cup(c, x + 2.3, y + 0.35, 16, false);
  box(R, P, x + 0.85, y + 0.22, 16, 0.16, 0.16, 4, K.glass, { a: 0.8 });
  plantPot(c, x + 1.85, y + 0.35, 16, false);
}

/** Leather-topped stool with a brass foot ring. */
function barStool(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x - 0.12, y - 0.12, 0, 0.24, 0.24, 1, IRON);
  box(R, P, x - 0.03, y - 0.03, 1, 0.06, 0.06, 10, IRON);
  disc(R, P, x, y, 0.16, 4, K.brass);
  disc(R, P, x, y, 0.12, 4.5, K.ink);
  disc(R, P, x, y, 0.21, 11, FRAME);
  disc(R, P, x, y, 0.2, 12, '#6b3f2a');
  disc(R, P, x - 0.04, y - 0.04, 0.08, 12.5, K.wood);
}

function cabinet(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  box(R, P, p.x, p.y, 0, p.w, p.d, 24, K.metal, { line: K.metalD, top: '#dde2e6' });
  if (faceVisible(0, 1)) for (let i = 0; i < 3; i++) {
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
    case 'officeChair': return officeChair(c, cx, cy, z);
    case 'plant': return plantPot(c, cx, cy, z, false);
    case 'bigPlant': return plantPot(c, cx, cy, z, true);
    case 'rug': return rugRect(c, p.x, p.y, p.w, p.d, z);
    case 'sofa': return sofa(c, p);
    case 'sideLamp': return sideLamp(c, cx, cy, z);
    case 'armchair': return armchair(c, p, z);
    case 'pendant': return pendant(c, p.x, p.y, ceiling, ceiling - 20);
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

/** The barista steams milk every few seconds: a puff rising off the wand. */
function steamPuff(c: DrawCtx, x: number, y: number, seed: number) {
  const ph = (c.t + seed) % 6;
  if (ph > 2.6) return;
  for (let k = 0; k < 4; k++) {
    const age = ph - k * 0.3;
    if (age < 0 || age > 1.6) continue;
    c.R.rect(x + Math.round(Math.sin(age * 5 + k) * 1.2), y - 2 - Math.round(age * 7), 2, 2, '#ffffff', 0.75 * (1 - age / 1.6));
  }
}

/** Wall clock showing the real time. */
function clock(R: Raster, cx: number, cy: number) {
  R.grid(CLOCK_FACE, CLOCK_PAL, cx - 4, cy - 4);
  const now = new Date();
  const m = now.getMinutes() + now.getSeconds() / 60, h = (now.getHours() % 12) + m / 60;
  const hand = (turns: number, len: number) => { const a = turns * Math.PI * 2; R.line(cx, cy, cx + Math.round(Math.sin(a) * len), cy - Math.round(Math.cos(a) * len), K.ink); };
  hand(h / 12, 2);
  hand(m / 60, 3);
  R.px(cx, cy, K.coral);
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
  const pl: Plane = SIDES[d.wall].pl;
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
    case 'clock': { const q = planePt(P, pl, d.a0, d.v0); return clock(R, q[0], q[1]); }
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

export function wallRun(c: DrawCtx, side: DecorSide, a0: number, a1: number, z0: number, z1: number, upper: boolean) {
  const { R, P } = c;
  const pl: Plane = SIDES[side].pl;
  const left = leftRole(side);
  const base = upper ? (left ? K.sageShade : K.sage) : left ? K.plasterShade : K.plaster;
  plane(R, P, pl, a0, a1, z0, z1, base);
  if (!upper) {
    plane(R, P, pl, a0, a1, z0, z0 + 16, left ? K.wainsDark : K.wains);
    for (let u = a0 + 0.25; u < a1; u += 0.25) {
      const p0 = planePt(P, pl, u, z0 + 1), p1 = planePt(P, pl, u, z0 + 15);
      R.line(p0[0], p0[1], p1[0], p1[1], K.wainsDark, 0.5);
    }
    plane(R, P, pl, a0, a1, z0 + 16, z0 + 18, K.trim);
  } else {
    plane(R, P, pl, a0, a1, z0, z0 + 3, K.trim);
  }
}

/**
 * The top of a wall (a strip as thick as the wall, toward the outside) and, where the
 * wall steps down at a1, the cut end from z down to `cutTo` (pass z for no step).
 */
export function wallCap(c: DrawCtx, side: DecorSide, a0: number, a1: number, z: number, cutTo: number) {
  const { R, P, theme } = c;
  const T = 0.28;
  const top = theme === 'snow' ? '#ffffff' : K.cap;
  const s = SIDES[side];
  const pt = (u: number, off: number, zz: number) => P(s.o[0] + s.u[0] * u + s.n[0] * off, s.o[1] + s.u[1] * u + s.n[1] * off, zz);
  // The street and patio walls run to the building's outer corners, so their caps close the corner.
  const outerEnd = side === 'F' || side === 'E' ? T : 0;
  // Wound the way the original caps were (it decides which pixel an exact-half edge takes).
  const capPts = [pt(a0 - T, T, z), pt(a1 + outerEnd, T, z), pt(a1, 0, z), pt(a0, 0, z)];
  const clockwise = s.u[0] * s.n[1] - s.u[1] * s.n[0] > 0;
  R.poly(clockwise ? [capPts[0]!, capPts[3]!, capPts[2]!, capPts[1]!] : capPts, top);
  if (cutTo !== z && faceVisible(s.u[0], s.u[1])) {
    // The end takes the shade of whichever face it looks like from here.
    const [ux, uy] = s.u;
    const darker = ux * camera.c - uy * camera.s > ux * camera.s + uy * camera.c;
    R.poly([pt(a1, T, z), pt(a1, 0, z), pt(a1, 0, cutTo), pt(a1, T, cutTo)], darker ? K.capSide : shade(K.capSide, 0.08));
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
