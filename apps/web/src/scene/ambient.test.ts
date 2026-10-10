import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cloudsAt } from './ambient';
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
    const at = (w: number, h: number) => renderScene(new Raster(w, h), [agent], { theme: 'day', t: 1, transparent: true }).agents[0]!;
    const base = at(SCENE_W, SCENE_H), wide = at(SCENE_W + 200, SCENE_H + 100);
    expect([wide.headX - base.headX, wide.headY - base.headY]).toEqual([100, 50]);
  });

  it('gets more clouds as it grows', () => {
    const count = (w: number, h: number, storm = false) => cloudsAt({ w, h }, storm, 0).length;
    expect(count(SCENE_W * 4, SCENE_H)).toBeGreaterThan(count(SCENE_W, SCENE_H));
    expect(count(SCENE_W * 4, SCENE_H * 2)).toBeGreaterThan(count(SCENE_W * 4, SCENE_H));
    expect(count(SCENE_W * 4, SCENE_H, true)).toBeGreaterThan(count(SCENE_W * 4, SCENE_H));
  });

  it.each([false, true])('keeps every cloud on the left in place as the frame narrows (storm: %s)', (storm) => {
    // The work board sliding open narrows the stage from the right; the sky on the left mustn't change.
    const left = (w: number, t: number) => cloudsAt({ w, h: SCENE_H }, storm, t).filter((c) => c.x < 900);
    for (const t of [0, 37.5, 400, 3000]) {
      const wide = left(1800, t);
      expect(wide.length).toBeGreaterThan(0);
      for (const w of [1500, 1200, 902]) expect(left(w, t)).toEqual(wide);
    }
  });
});
