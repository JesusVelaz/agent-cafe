/**
 * The café from today's angle must not change by a single pixel. These hashes were
 * recorded from the renderer before the turntable camera existed; if one fails, the
 * default view drew something differently. (A deliberate art change updates them:
 * run with GOLDEN=print to see the new values.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThemeId } from './atmosphere';
import { renderScene, SCENE_H, SCENE_W } from './building';
import { cats, crew } from './fixtures';
import { Raster } from './raster';

/** FNV-1a over the colour and emissive buffers. */
function hash(R: Raster): string {
  let h = 0x811c9dc5;
  const mix = (v: number) => { h ^= v; h = Math.imul(h, 0x01000193) >>> 0; };
  for (let i = 0; i < R.d.length; i++) mix(R.d[i]!);
  for (let i = 0; i < R.em.length; i++) mix(R.em[i]!);
  return h.toString(16).padStart(8, '0');
}

const CASES: Array<[ThemeId, number, number, number]> = [
  ['day', 3, SCENE_W, SCENE_H],
  ['day', 17, 640, 420],
  ['summer', 9, SCENE_W, SCENE_H],
  ['rain', 5, SCENE_W, SCENE_H],
  ['snow', 11, SCENE_W, SCENE_H],
  ['night', 3, SCENE_W, SCENE_H],
  ['night', 23, 640, 420],
];

const EXPECTED: Record<string, string> = {
  'day@3 480x400': '965ec83b',
  'day@17 640x420': 'dedd1bb8',
  'summer@9 480x400': '04d1dacb',
  'rain@5 480x400': 'dc3162b4',
  'snow@11 480x400': '3483594f',
  'night@3 480x400': '0e3ee9c7',
  'night@23 640x420': '9d2146e3',
};

describe('default view', () => {
  // The wall clocks show the real time; pin it (a local time, so any time zone agrees).
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-10T10:20:00')); });
  afterEach(() => vi.useRealTimers());

  for (const [theme, t, w, h] of CASES) {
    const key = `${theme}@${t} ${w}x${h}`;
    it(`renders ${key} exactly as before`, () => {
      const R = new Raster(w, h);
      renderScene(R, crew, { theme, t, selectedId: 'earl', floors: { openai: { mode: 'mock', closed: false }, anthropic: { mode: 'live', closed: true } }, cats });
      const got = hash(R);
      if (process.env.GOLDEN === 'print') console.log(`  '${key}': '${got}',`);
      else expect(got).toBe(EXPECTED[key]);
    });
  }
});
