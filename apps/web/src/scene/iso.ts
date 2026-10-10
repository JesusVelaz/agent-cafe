/**
 * Isometric projection and shape helpers. 2:1 dimetric tiles (24×12 px).
 * Light comes from the upper left: tops are lightest, the +y face (screen
 * lower-left) is the base colour, the +x face is darkest.
 */
import { BUILDING, type Dir } from '@/sim/layout';
import { shade } from './palette';
import type { Pt2, Raster } from './raster';

export const HW = 12;
export const HH = 6;

/** World (tile x, tile y, height px) → screen px. */
export type Proj = (x: number, y: number, z?: number) => Pt2;

// ── camera ──────────────────────────────────────────────────────────────────
//
// The café can be turned. The camera spins the world about the street plot's
// centre (so the whole plot stays in frame at every angle) before projecting.
// It is set once per frame by renderScene; everything drawn in that frame reads it.
// At angle 0 every helper here is exactly the fixed projection the café always had.

export const camera = { a: 0, c: 1, s: 0, px: BUILDING.PW / 2, py: BUILDING.PD / 2 };

/** Turn the camera to `a` radians (0 = today's view, from the street corner). */
export function setCameraAngle(a: number): void {
  const snapped = Math.abs(a) < 1e-9 ? 0 : a;
  camera.a = snapped;
  camera.c = Math.cos(snapped);
  camera.s = Math.sin(snapped);
}

/** World → camera-space tile coordinates. */
export function turn(x: number, y: number): [number, number] {
  if (camera.a === 0) return [x, y];
  const dx = x - camera.px, dy = y - camera.py;
  return [camera.px + dx * camera.c - dy * camera.s, camera.py + dx * camera.s + dy * camera.c];
}

/** Camera-space → world, for screen-space passes that map pixels back onto the ground. */
export function unturn(x: number, y: number): [number, number] {
  if (camera.a === 0) return [x, y];
  const dx = x - camera.px, dy = y - camera.py;
  return [camera.px + dx * camera.c + dy * camera.s, camera.py - dx * camera.s + dy * camera.c];
}

/** Painter's depth: bigger is nearer the viewer. It is x + y at angle 0. */
export function depth(x: number, y: number): number {
  const [u, v] = turn(x, y);
  return u + v;
}

/** How squarely a vertical face with this outward normal points at the viewer, −1…1. */
export function facing(nx: number, ny: number): number {
  return (nx * (camera.c + camera.s) + ny * (camera.c - camera.s)) / Math.SQRT2;
}

/** Does a vertical face with this outward normal point at the viewer? */
export const faceVisible = (nx: number, ny: number) => facing(nx, ny) > 1e-6;

/** The camera's nearest quarter turn, 0–3. */
export const quarter = () => ((Math.round(camera.a / (Math.PI / 2)) % 4) + 4) % 4;

const DIRS: Dir[] = ['x+', 'y+', 'x-', 'y-'];

/** A world facing as the camera sees it: which way a sprite should look on screen. */
export const viewFace = (f: Dir): Dir => DIRS[(DIRS.indexOf(f) + quarter()) % 4]!;

export function iso(ox: number, oy: number): Proj {
  return (x, y, z = 0) => {
    if (camera.a !== 0) [x, y] = turn(x, y);
    return [Math.round(ox + (x - y) * HW), Math.round(oy + (x + y) * HH - z)];
  };
}

export interface BoxOpts {
  top?: string;
  right?: string;
  a?: number;
  em?: boolean;
  /** Pixel-art outline: true = derived from the colour, or an explicit colour. */
  line?: boolean | string;
}

export function box(R: Raster, P: Proj, x: number, y: number, z: number, w: number, d: number, h: number, col: string, o: BoxOpts = {}): void {
  const top = o.top ?? shade(col, 0.14);
  const right = o.right ?? shade(col, -0.2);
  const zt = z + h;
  const a = o.a ?? 1;
  // Corners are named by where they land on screen: C is always the one nearest the
  // viewer, so the two faces drawn are the two that face us, in their usual shades.
  const q: Array<[number, number]> = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  let n = 2;
  if (camera.a !== 0) {
    let best = -Infinity;
    q.forEach(([qx, qy], i) => { const dd = depth(qx, qy); if (dd > best + 1e-9) { best = dd; n = i; } });
  }
  const qa = q[(n + 2) % 4]!, qb = q[(n + 3) % 4]!, qc = q[n]!, qd = q[(n + 1) % 4]!;
  const A = P(qa[0], qa[1], zt), B = P(qb[0], qb[1], zt), C = P(qc[0], qc[1], zt), D = P(qd[0], qd[1], zt);
  const Cb = P(qc[0], qc[1], z), Db = P(qd[0], qd[1], z), Bb = P(qb[0], qb[1], z);
  if (h > 0) {
    R.poly([D, C, Cb, Db], col, a, o.em);
    R.poly([C, B, Bb, Cb], right, a, o.em);
  }
  R.poly([A, B, C, D], top, a, o.em);
  if (o.line) {
    const ln = typeof o.line === 'string' ? o.line : shade(col, -0.45);
    R.line(A[0], A[1], B[0], B[1], ln); R.line(A[0], A[1], D[0], D[1], ln);
    R.line(D[0], D[1], Db[0], Db[1], ln); R.line(Db[0], Db[1], Cb[0], Cb[1], ln);
    R.line(Cb[0], Cb[1], Bb[0], Bb[1], ln); R.line(Bb[0], Bb[1], B[0], B[1], ln);
    if (h > 0) R.line(C[0], C[1], Cb[0], Cb[1], shade(col, -0.3));
    R.line(D[0], D[1], C[0], C[1], shade(top, 0.12)); R.line(C[0], C[1], B[0], B[1], shade(top, 0.12));
  }
}

/** A vertical plane: `{x}` spans y, `{y}` spans x. `a` along it in tiles, `v` height in px. */
export type Plane = { x: number; y?: undefined } | { y: number; x?: undefined };

export function planePt(P: Proj, pl: Plane, u: number, v: number): Pt2 {
  return pl.x !== undefined ? P(pl.x, u, v) : P(u, pl.y!, v);
}

export function plane(R: Raster, P: Proj, pl: Plane, a0: number, a1: number, v0: number, v1: number, col: string, a = 1, em = false): void {
  R.poly([planePt(P, pl, a0, v1), planePt(P, pl, a1, v1), planePt(P, pl, a1, v0), planePt(P, pl, a0, v0)], col, a, em);
}

export function quad(R: Raster, P: Proj, x: number, y: number, w: number, d: number, z: number, col: string, a = 1, em = false): void {
  R.poly([P(x, y, z), P(x + w, y, z), P(x + w, y + d, z), P(x, y + d, z)], col, a, em);
}

export function disc(R: Raster, P: Proj, cx: number, cy: number, r: number, z: number, col: string, a = 1): void {
  const pts: Pt2[] = [];
  for (let i = 0; i < 20; i++) {
    const t = (i / 20) * Math.PI * 2;
    pts.push(P(cx + Math.cos(t) * r, cy + Math.sin(t) * r, z));
  }
  R.poly(pts, col, a);
}
