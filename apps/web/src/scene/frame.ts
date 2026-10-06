/**
 * The frame the café is drawn into. The plot is laid out for a SCENE_W × SCENE_H
 * frame; a bigger frame (the stage's whole width at the same pixel scale) keeps the
 * plot centred and fills the extra room with sky.
 */
import type { Raster } from './raster';

export const SCENE_W = 480;
export const SCENE_H = 400;

/** How far the plot shifts to stay centred in this frame. */
export const plotOffset = (R: Pick<Raster, 'w' | 'h'>) => ({ x: Math.floor((R.w - SCENE_W) / 2), y: Math.floor((R.h - SCENE_H) / 2) });

/** `n` things per base frame, scaled to this frame's area (so weather stays as dense). */
export const perArea = (n: number, R: Pick<Raster, 'w' | 'h'>) => Math.round((n * R.w * R.h) / (SCENE_W * SCENE_H));

/** The biggest frame worth drawing (only a tiny scale on a huge stage gets near it). */
const MAX_FRAME = { w: 2560, h: 1600 };

/**
 * Pixel scale and frame size for a stage of this many CSS px. The plot is fitted
 * (a whole-number scale when it fits, for crisp pixels; fractional only when small)
 * and the frame around it covers the whole stage at that scale.
 */
export function fitFrame(width: number, height: number, reserveBottom = 0): { scale: number; w: number; h: number } {
  const f = Math.min((width - 16) / SCENE_W, (height - 16 - reserveBottom) / SCENE_H);
  const scale = f >= 2 ? Math.floor(f) : Math.max(0.25, f);
  // Grow the frame two pixels at a time so the plot's offset is always exact: the café
  // then sits dead centre at every stage size instead of wobbling a pixel as it resizes.
  const fit = (px: number, base: number, max: number) => Math.min(max, base + 2 * Math.max(0, Math.ceil((px / scale - base) / 2)));
  return { scale, w: fit(width, SCENE_W, MAX_FRAME.w), h: fit(height, SCENE_H, MAX_FRAME.h) };
}
