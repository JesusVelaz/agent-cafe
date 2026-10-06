import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { skyClouds } from './ambient';
import type { ThemeId } from './atmosphere';
import { renderScene, SCENE_H, SCENE_W } from './building';
import { Raster } from './raster';

const frame = (t: number, theme: ThemeId = 'day') => {
  const R = new Raster(SCENE_W, SCENE_H);
  renderScene(R, [], { theme, t, transparent: true });
  return R.d;
};

describe('ambient motion', () => {
  // The wall clocks read the real time; pin it so frames compare.
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 5, 10, 10)); });
  afterEach(() => vi.useRealTimers());

  it.each(['day', 'rain', 'night'] as const)('draws the same %s frame for the same time', (theme) => {
    expect(frame(37.5, theme)).toEqual(frame(37.5, theme));
  });

  it('moves as time passes', () => {
    expect(frame(10)).not.toEqual(frame(14));
  });
});

describe('a bigger frame', () => {
  it('keeps the café centred', () => {
    const agent = { id: 'a', name: 'A', providerId: 'openai' as const, x: 5, y: 9, face: 'y+' as const, pose: 'stand' as const, t: 0, bubble: null, spriteSeed: 1, demo: true };
    const at = (w: number, h: number) => renderScene(new Raster(w, h), [agent], { theme: 'day', t: 1, transparent: true })[0]!;
    const base = at(SCENE_W, SCENE_H), wide = at(SCENE_W + 200, SCENE_H + 100);
    expect([wide.headX - base.headX, wide.headY - base.headY]).toEqual([100, 50]);
  });

  it('gets more clouds as it grows', () => {
    expect(skyClouds({ w: SCENE_W, h: SCENE_H }, false)).toHaveLength(5);
    expect(skyClouds({ w: SCENE_W * 2, h: SCENE_H }, false).length).toBe(10);
    expect(skyClouds({ w: SCENE_W * 2, h: SCENE_H }, true).length).toBeGreaterThan(10);
  });
});
