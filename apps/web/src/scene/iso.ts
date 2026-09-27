/**
 * Isometric projection and shape helpers. 2:1 dimetric tiles (24×12 px), drawn
 * into Pixi Graphics with antialiasing off so edges step like hand-placed pixels.
 */
import type { Graphics } from 'pixi.js';
import { shade } from './palette';

export const TILE_W = 24;
export const TILE_H = 12;
export const HALF_W = TILE_W / 2;
export const HALF_H = TILE_H / 2;
export const WALL_H = 56;

export interface Pt {
  x: number;
  y: number;
}

/** A floor's screen origin: where tile corner (0,0) at z=0 lands. */
export interface Origin {
  ox: number;
  oy: number;
}

/** World (tile x, tile y, height px) → screen px, rounded to whole pixels. */
export function proj(o: Origin, x: number, y: number, z = 0): Pt {
  return { x: Math.round(o.ox + (x - y) * HALF_W), y: Math.round(o.oy + (x + y) * HALF_H - z) };
}

const flat = (pts: Pt[]) => pts.flatMap((p) => [p.x, p.y]);

export function poly(g: Graphics, pts: Pt[], color: string, alpha = 1) {
  g.poly(flat(pts)).fill({ color, alpha });
}

/** A flat diamond covering a tile rectangle on the floor plane. */
export function floorQuad(g: Graphics, o: Origin, x: number, y: number, w: number, d: number, color: string, z = 0) {
  poly(g, [proj(o, x, y, z), proj(o, x + w, y, z), proj(o, x + w, y + d, z), proj(o, x, y + d, z)], color);
}

export interface BoxStyle {
  /** Base colour; used for the left (lit) face. */
  color: string;
  top?: string;
  right?: string;
  /** Draw a 1px darker line along the top edges for definition. */
  edge?: boolean;
}

/**
 * An axis-aligned box. Light comes from the upper left: top is lightest, the
 * +y face (screen lower-left) is the base colour, the +x face is darkest.
 */
export function box(
  g: Graphics,
  o: Origin,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  style: BoxStyle | string,
) {
  const st = typeof style === 'string' ? { color: style } : style;
  const top = st.top ?? shade(st.color, 0.16);
  const right = st.right ?? shade(st.color, -0.22);
  const zt = z + h;
  const A = proj(o, x, y, zt);
  const B = proj(o, x + w, y, zt);
  const Cc = proj(o, x + w, y + d, zt);
  const D = proj(o, x, y + d, zt);
  const Cb = proj(o, x + w, y + d, z);
  const Db = proj(o, x, y + d, z);
  const Bb = proj(o, x + w, y, z);
  if (h > 0) {
    poly(g, [D, Cc, Cb, Db], st.color); // +y face
    poly(g, [Cc, B, Bb, Cb], right); // +x face
  }
  poly(g, [A, B, Cc, D], top);
  if (st.edge) {
    const e = shade(st.color, -0.35);
    g.moveTo(D.x, D.y).lineTo(Cc.x, Cc.y).lineTo(B.x, B.y).stroke({ width: 1, color: e, alpha: 0.6 });
  }
}

/** A world-space circle on a horizontal plane at height z, as a polygon. */
export function isoEllipse(g: Graphics, o: Origin, cx: number, cy: number, r: number, z: number, color: string) {
  const pts: Pt[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push(proj(o, cx + Math.cos(a) * r, cy + Math.sin(a) * r, z));
  }
  poly(g, pts, color);
}

/**
 * A rectangle on a wall plane. `u` runs along the wall in tiles, `v` is height px.
 * Left wall is the x=0 plane (u = y), right wall the y=0 plane (u = x).
 */
export function wallRect(
  g: Graphics,
  o: Origin,
  wall: 'left' | 'right',
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  color: string,
  alpha = 1,
) {
  const at = (u: number, v: number) => (wall === 'left' ? proj(o, 0, u, v) : proj(o, u, 0, v));
  poly(g, [at(u0, v1), at(u1, v1), at(u1, v0), at(u0, v0)], color, alpha);
}

/** Screen point on a wall plane (for placing sprites and text). */
export function wallPoint(o: Origin, wall: 'left' | 'right', u: number, v: number): Pt {
  return wall === 'left' ? proj(o, 0, u, v) : proj(o, u, 0, v);
}
