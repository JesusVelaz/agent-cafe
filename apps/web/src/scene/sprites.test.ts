import { describe, expect, it } from 'vitest';
import { resolveTheme } from '@/lib/theme';
import { grade } from './atmosphere';
import { glyphRows } from './font';
import { Raster } from './raster';
import { accessorize, AGENT, AGENT_H, AGENT_W, agentLook, ICONS, withApron, type AgentFrame } from './sprites';

describe('sprite grids', () => {
  const frames = Object.keys(AGENT) as AgentFrame[];
  it.each(frames)('%s is 12×20, with every accessory and the apron', (f) => {
    for (const acc of ['none', 'glasses', 'phones', 'beanie'] as const) {
      const g = withApron(accessorize(AGENT[f], acc, f), f);
      expect(g).toHaveLength(AGENT_H);
      for (const row of g) expect(row).toHaveLength(AGENT_W);
    }
  });
  it('icons are 7×5 and glyphs 3×5', () => {
    for (const g of Object.values(ICONS)) { expect(g).toHaveLength(5); for (const r of g) expect(r).toHaveLength(7); }
    for (const ch of 'ABCXYZ0189 .-!·$') { const rows = glyphRows(ch); expect(rows).toHaveLength(5); for (const r of rows) expect(r).toHaveLength(3); }
  });
  it('gives an agent the same look every time', () => {
    expect(agentLook(41)).toEqual(agentLook(41));
  });
});

describe('raster', () => {
  it('fills an axis-aligned square exactly', () => {
    const R = new Raster(10, 10);
    R.poly([[2, 2], [6, 2], [6, 6], [2, 6]], '#ff0000');
    let filled = 0;
    for (let i = 0; i < 100; i++) if (R.d[i * 4 + 3] === 255) filled++;
    expect(filled).toBe(16);
    expect(R.d[(2 * 10 + 2) * 4]).toBe(255);
    expect(R.d[(6 * 10 + 6) * 4 + 3]).toBe(0);
  });
  it('leaves emissive pixels alone when grading for night', () => {
    const R = new Raster(2, 1);
    R.rect(0, 0, 1, 1, '#c8c8c8');
    R.rect(1, 0, 1, 1, '#c8c8c8', 1, true);
    grade(R, 'night', []);
    expect(R.d[0]).toBeLessThan(200);
    expect(R.d[4]).toBe(200);
  });
});

describe('resolveTheme', () => {
  const at = (month: number, h: number, m = 0) => new Date(2026, month, 15, h, m);
  it.each([
    [at(4, 22), 'night'],
    [at(4, 5, 30), 'night'],
    [at(6, 18, 30), 'summer'],
    [at(0, 12), 'snow'],
    [at(4, 12), 'day'],
  ])('%s → %s', (d, want) => expect(resolveTheme(d as Date)).toBe(want));
  it('respects a manual override', () => {
    expect(resolveTheme(at(4, 12), 'rain')).toBe('rain');
  });
});
