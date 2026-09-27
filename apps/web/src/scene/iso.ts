/**
 * Isometric projection and shape helpers. 2:1 dimetric tiles (24×12 px).
 * Light comes from the upper left: tops are lightest, the +y face (screen
 * lower-left) is the base colour, the +x face is darkest.
 */
import { shade } from './palette';
import type { Pt2, Raster } from './raster';

export const HW = 12;
export const HH = 6;

/** World (tile x, tile y, height px) → screen px. */
export type Proj = (x: number, y: number, z?: number) => Pt2;

export function iso(ox: number, oy: number): Proj {
  return (x, y, z = 0) => [Math.round(ox + (x - y) * HW), Math.round(oy + (x + y) * HH - z)];
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
  const A = P(x, y, zt), B = P(x + w, y, zt), C = P(x + w, y + d, zt), D = P(x, y + d, zt);
  const Cb = P(x + w, y + d, z), Db = P(x, y + d, z), Bb = P(x + w, y, z);
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
