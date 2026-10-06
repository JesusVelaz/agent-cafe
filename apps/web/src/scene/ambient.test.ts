import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
