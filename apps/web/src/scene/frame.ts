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
