import { describe, expect, it } from 'vitest';
import { resolveTheme } from '@/lib/theme';
import { grade } from './atmosphere';
import { glyphRows } from './font';
import { Raster } from './raster';
import { AGENT_FRAMES, AGENT_H, AGENT_W, agentGrid, agentLook, agentSprite, HAIR_STYLES, ICONS, MOODS, TREE } from './sprites';

describe('sprite grids', () => {
  it.each(AGENT_FRAMES)('%s is 14×20 for every hairstyle, outfit, accessory and mood', (f) => {
    for (const hair of HAIR_STYLES) for (const outfit of ['casual', 'office', 'apron'] as const) for (const acc of ['none', 'glasses', 'phones', 'visor', 'beanie'] as const) {
      for (const mood of [undefined, ...MOODS]) {
        const g = agentGrid(f, { hair, outfit, accessory: acc }, mood);
        expect(g).toHaveLength(AGENT_H);
        for (const row of g) expect(row).toHaveLength(AGENT_W);
      }
    }
  });
  it('gives every pixel of a finished sprite a colour, and tints outlines that border a fill', () => {
    const bad: string[] = [];
    for (let seed = 1; seed <= 12; seed++) for (const outfit of ['casual', 'office', 'apron'] as const) {
      const look = agentLook(seed, outfit);
      for (const f of AGENT_FRAMES) for (const mood of [undefined, ...MOODS]) {
        const { grid, palette } = agentSprite(f, look, mood);
        const fill = (n: string | undefined) => n !== undefined && n !== '.' && n !== 'o' && n.charCodeAt(0) < 0xe000;
        grid.forEach((row, y) => [...row].forEach((ch, x) => {
          if (ch === '.') return;
          if (!palette[ch]) bad.push(`${seed} ${f} ${mood}: no colour for '${ch}'`);
          if (ch === 'o' && [grid[y - 1]?.[x], grid[y + 1]?.[x], row[x - 1], row[x + 1]].some(fill)) bad.push(`${seed} ${f} ${mood}: plain ink at (${x},${y})`);
        }));
      }
    }
    expect(bad).toEqual([]);
  });
  it('only changes the face and arm for a mood, on front-facing frames', () => {
    const look = agentLook(12, 'office');
    expect(agentGrid('backStand', look, 'ask')).toEqual(agentGrid('backStand', look));
    expect(agentGrid('sleep', look, 'done')).toEqual(agentGrid('sleep', look));
    for (const mood of MOODS) expect(agentGrid('stand', look, mood)).not.toEqual(agentGrid('stand', look));
  });
  it('icons are 7×5 and glyphs 3×5', () => {
    for (const g of Object.values(ICONS)) { expect(g).toHaveLength(5); for (const r of g) expect(r).toHaveLength(7); }
    for (const ch of 'ABCXYZ0189 .-!·$') { const rows = glyphRows(ch); expect(rows).toHaveLength(5); for (const r of rows) expect(r).toHaveLength(3); }
  });
  it('gives an agent the same look every time', () => {
    expect(agentLook(41, 'office')).toEqual(agentLook(41, 'office'));
    const rows = TREE.map((r) => r.length);
    expect(new Set(rows).size).toBe(1);
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
