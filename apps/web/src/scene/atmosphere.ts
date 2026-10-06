/**
 * Themes, backdrop, weather particles and the lighting pass.
 *
 * Lighting: every pixel is multiplied by the theme's ambient colour plus the
 * summed light of nearby lamps. Lamp falloff is quantised into four bands with
 * a 4×4 Bayer dither, which gives the stepped "pixel art" light pools. Emissive
 * pixels (windows, bulbs, screens, the outside backdrop) are left untouched.
 */
import { perArea } from './frame';
import { hash, rgb, type RGB } from './palette';
import type { Raster } from './raster';

export type ThemeId = 'day' | 'summer' | 'rain' | 'snow' | 'night';
export const THEME_IDS: ThemeId[] = ['day', 'summer', 'rain', 'snow', 'night'];

export interface Theme {
  /** Backdrop gradient, top → bottom. */
  bg: [string, string];
  /** Ambient multiplier for everything indoors. */
  amb: RGB;
  /** How strongly lamps count (they barely matter at noon). */
  lamp: number;
  /** Window sky gradient, top → bottom. */
  sky: [string, string];
  floorShadow: string;
}

export const THEMES: Record<ThemeId, Theme> = {
  day: { bg: ['#efe3cf', '#e2d2b8'], amb: [1, 1, 1], lamp: 0.12, sky: ['#9fd0ea', '#d6eef7'], floorShadow: '#c9b596' },
  summer: { bg: ['#f7d7a5', '#eab983'], amb: [1.04, 0.99, 0.9], lamp: 0.08, sky: ['#6fb8e6', '#f5e0a0'], floorShadow: '#d49d6b' },
  rain: { bg: ['#6d7c89', '#56636f'], amb: [0.8, 0.84, 0.92], lamp: 0.55, sky: ['#6e7f8e', '#9aa8b3'], floorShadow: '#46515b' },
  snow: { bg: ['#dfe7ee', '#c7d3de'], amb: [0.9, 0.93, 1.0], lamp: 0.45, sky: ['#b9c9d8', '#e8eef4'], floorShadow: '#aebdca' },
  night: { bg: ['#232a42', '#171c2e'], amb: [0.36, 0.4, 0.6], lamp: 1.0, sky: ['#141a33', '#2a3358'], floorShadow: '#0f1322' },
};

/** Is this a "lights on" theme (lamps glow, candles lit)? */
export const isDim = (t: ThemeId) => t === 'night' || t === 'rain' || t === 'snow';

export interface Light {
  x: number;
  y: number;
  r: number;
  col: RGB;
  s: number;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Outside: gradient (or transparent when the page supplies it) plus weather behind the building. */
export function backdrop(R: Raster, theme: ThemeId, t: number, transparent: boolean): void {
  const TH = THEMES[theme];
  if (transparent) {
    R.clear();
  } else {
    const c0 = rgb(TH.bg[0]);
    const c1 = rgb(TH.bg[1]);
    const d = R.d;
    for (let y = 0; y < R.h; y++) {
      for (let x = 0; x < R.w; x++) {
        const k = Math.min(1, Math.max(0, y / R.h + (BAYER[(y & 3) * 4 + (x & 3)]! / 16 - 0.5) * 0.12));
        const q = Math.round(k * 6) / 6;
        const o = (y * R.w + x) * 4;
        d[o] = c0[0] + (c1[0] - c0[0]) * q;
        d[o + 1] = c0[1] + (c1[1] - c0[1]) * q;
        d[o + 2] = c0[2] + (c1[2] - c0[2]) * q;
        d[o + 3] = 255;
      }
    }
    R.em.fill(1);
  }
  if (theme === 'night') for (let i = 0; i < perArea(40, R); i++) R.px(hash(i * 3) * R.w, hash(i * 7 + 1) * R.h * 0.6, '#fff6d8', 0.35 + 0.35 * Math.sin(t + i), true);
  if (theme === 'rain') {
    for (let i = 0; i < perArea(90, R); i++) {
      let x0 = (hash(i * 13) * (R.w + 60) - t * 10) % (R.w + 60);
      if (x0 < 0) x0 += R.w + 60;
      const y0 = (hash(i * 17 + 3) * R.h + t * (160 + hash(i) * 60)) % R.h;
      R.line(x0, y0, x0 - 2, y0 + 6, '#c9d6e2', 0.45, true);
    }
  }
  if (theme === 'snow') {
    for (let i = 0; i < perArea(120, R); i++) {
      const sx = (hash(i * 13) * R.w + Math.sin(t * 0.8 + i) * 6 + R.w) % R.w;
      const sy = (hash(i * 17 + 3) * R.h + t * (12 + hash(i) * 10)) % R.h;
      const big = hash(i * 5) > 0.7;
      R.rect(sx, sy, big ? 2 : 1, big ? 2 : 1, '#ffffff', 0.9, true);
    }
  }
  if (theme === 'summer') for (let i = 0; i < perArea(12, R); i++) R.px((hash(i * 9) * R.w + t * 4) % R.w, (hash(i * 4) * R.h - t * 3 + R.h) % R.h, '#fff4c4', 0.6, true);
}

/** A few flakes in front of the building for depth. */
export function frontWeather(R: Raster, theme: ThemeId, t: number): void {
  if (theme !== 'snow') return;
  for (let i = 0; i < perArea(30, R); i++) {
    const sx = (hash(i * 29 + 7) * R.w + Math.sin(t + i) * 5 + R.w) % R.w;
    const sy = (hash(i * 31) * R.h + t * 18) % R.h;
    R.rect(sx, sy, 2, 2, '#ffffff', 0.95, true);
  }
}

export function grade(R: Raster, theme: ThemeId, lights: Light[]): void {
  const TH = THEMES[theme];
  const { w, h } = R;
  const lm = new Float32Array(w * h * 3);
  for (const L of lights) {
    const s = L.s * TH.lamp;
    if (s <= 0.001) continue;
    const x0 = Math.max(0, Math.floor(L.x - L.r)), x1 = Math.min(w - 1, Math.ceil(L.x + L.r));
    const y0 = Math.max(0, Math.floor(L.y - L.r * 0.7)), y1 = Math.min(h - 1, Math.ceil(L.y + L.r * 0.7));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = (x - L.x) / L.r, dy = (y - L.y) / (L.r * 0.6);
        const dd = dx * dx + dy * dy;
        if (dd >= 1) continue;
        let f = 1 - Math.sqrt(dd);
        f *= f;
        const lvl = Math.floor(f * 4 + BAYER[(y & 3) * 4 + (x & 3)]! / 16) / 4;
        if (lvl <= 0) continue;
        const o = (y * w + x) * 3;
        lm[o] = lm[o]! + L.col[0] * lvl * s;
        lm[o + 1] = lm[o + 1]! + L.col[1] * lvl * s;
        lm[o + 2] = lm[o + 2]! + L.col[2] * lvl * s;
      }
    }
  }
  const d = R.d;
  for (let i = 0; i < w * h; i++) {
    if (R.em[i]) continue;
    const o4 = i * 4, o3 = i * 3;
    d[o4] = d[o4]! * (TH.amb[0] + lm[o3]!);
    d[o4 + 1] = d[o4 + 1]! * (TH.amb[1] + lm[o3 + 1]!);
    d[o4 + 2] = d[o4 + 2]! * (TH.amb[2] + lm[o3 + 2]!);
  }
}
