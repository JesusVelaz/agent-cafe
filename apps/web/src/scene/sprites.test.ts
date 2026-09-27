import { describe, expect, it } from 'vitest';
import { GLYPH_W, glyphRows } from './pixelFont';
import { AGENT_BACK, AGENT_FRONT, AGENT_H, AGENT_W, ICONS, withApron } from './sprites';

describe('sprite grids', () => {
  it.each(Object.entries({ ...AGENT_FRONT }))('front %s is %i×%i', (_name, grid) => {
    expect(grid).toHaveLength(AGENT_H);
    for (const row of grid) expect(row).toHaveLength(AGENT_W);
  });
  it.each(Object.entries({ ...AGENT_BACK }))('back %s is rectangular', (_name, grid) => {
    expect(grid).toHaveLength(AGENT_H);
    for (const row of grid) expect(row).toHaveLength(AGENT_W);
  });
  it('icons are 7×5', () => {
    for (const grid of Object.values(ICONS)) {
      expect(grid).toHaveLength(5);
      for (const row of grid) expect(row).toHaveLength(7);
    }
  });
  it('apron keeps dimensions', () => {
    const g = withApron(AGENT_FRONT.stand, false);
    expect(g.every((r) => r.length === AGENT_W)).toBe(true);
    expect(g.join('')).toContain('a');
  });
  it('font glyphs are 3×5', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?-+:·/$%()&#<>') {
      const rows = glyphRows(ch);
      expect(rows).toHaveLength(5);
      for (const r of rows) expect(r).toHaveLength(GLYPH_W);
    }
  });
});
