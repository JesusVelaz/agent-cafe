/**
 * A tiny software framebuffer. Polygons are filled by scanline at pixel centres
 * with no antialiasing, so every edge steps like hand-placed pixel art.
 *
 * `em` marks emissive pixels (windows, bulbs, screens, the backdrop): the
 * lighting pass leaves them untouched so they glow at night.
 */
import { rgb, type RGB } from './palette';

export type Pt2 = [number, number];

export class Raster {
  readonly d: Uint8ClampedArray<ArrayBuffer>;
  readonly em: Uint8Array;

  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.d = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
    this.em = new Uint8Array(w * h);
  }

  span(y: number, x0: number, x1: number, c: RGB, a: number, em: boolean): void {
    if (y < 0 || y >= this.h) return;
    if (x0 < 0) x0 = 0;
    if (x1 >= this.w) x1 = this.w - 1;
    const d = this.d;
    let i = y * this.w + x0;
    let o = i * 4;
    for (let x = x0; x <= x1; x++, i++, o += 4) {
      if (a >= 1) {
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
        this.em[i] = em ? 1 : 0;
      } else if (d[o + 3] === 0) {
        // Onto a transparent pixel: take the colour, keep the coverage as alpha.
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.round(a * 255);
        if (em) this.em[i] = 1;
      } else {
        d[o] = d[o]! + (c[0] - d[o]!) * a;
        d[o + 1] = d[o + 1]! + (c[1] - d[o + 1]!) * a;
        d[o + 2] = d[o + 2]! + (c[2] - d[o + 2]!) * a;
        if (em) this.em[i] = 1;
      }
    }
  }

  px(x: number, y: number, hex: string, a = 1, em = false): void {
    x = Math.round(x);
    y = Math.round(y);
    this.span(y, x, x, rgb(hex), a, em);
  }

  rect(x: number, y: number, w: number, h: number, hex: string, a = 1, em = false): void {
    x = Math.round(x);
    y = Math.round(y);
    const c = rgb(hex);
    for (let j = 0; j < h; j++) this.span(y + j, x, x + w - 1, c, a, em);
  }

  poly(pts: Pt2[], hex: string, a = 1, em = false): void {
    const c = rgb(hex);
    const n = pts.length;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.h - 1, Math.ceil(maxY));
    const xs: number[] = [];
    for (let y = minY; y <= maxY; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const p = pts[i]!;
        const q = pts[(i + 1) % n]!;
        if ((p[1] <= sy && q[1] > sy) || (q[1] <= sy && p[1] > sy)) xs.push(p[0] + ((sy - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      xs.sort((u, v) => u - v);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.ceil(xs[k]! - 0.5);
        const xb = Math.floor(xs[k + 1]! - 0.5);
        if (xb >= xa) this.span(y, xa, xb, c, a, em);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, hex: string, a = 1, em = false): void {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    const c = rgb(hex);
    for (let guard = 0; guard < 4000; guard++) {
      this.span(y0, x0, x0, c, a, em);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Draw a palette-indexed grid; chars listed in `emit` glow. */
  grid(g: readonly string[], pal: Record<string, string>, x: number, y: number, flip = false, emit = ''): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let r = 0; r < g.length; r++) {
      const row = g[r]!;
      for (let ci = 0; ci < row.length; ci++) {
        const ch = row[ci]!;
        const col = pal[ch];
        if (!col) continue;
        const px = x + (flip ? row.length - 1 - ci : ci);
        this.span(y + r, px, px, rgb(col), 1, emit.includes(ch));
      }
    }
  }

  clear(): void {
    this.d.fill(0);
    this.em.fill(1);
  }
}
