import { describe, expect, it } from 'vitest';
import { CUP_FILL_ROWS, cupFillPixels, cupPixels } from './cup';

const at = (px: ReturnType<typeof cupFillPixels>, x: number, y: number) => px.find((p) => p.x === x && p.y === y)?.fill;
const COFFEE = '#6b3f22';
const CREMA = '#c9975f';
const EMPTY = '#262a31';

describe('the filling cup', () => {
  it('is empty inside at level 0, with the same outline as the logo and no face or steam', () => {
    const px = cupFillPixels(0);
    expect(px.some((p) => p.steam)).toBe(false);
    expect(at(px, 5, 12)).toBe(EMPTY);
    expect(at(px, 5, 6)).toBe(EMPTY);
    const outline = (list: typeof px) => list.filter((p) => p.fill === '#2b1d17' && p.y >= 4).map((p) => `${p.x},${p.y}`).sort();
    // The logo's face is drawn in the outline colour too; the empty cup keeps only the outline.
    expect(outline(px).every((k) => outline(cupPixels('working')).includes(k))).toBe(true);
  });

  it('fills from the bottom, one row per step, with crema on top', () => {
    const four = cupFillPixels(4 / CUP_FILL_ROWS);
    expect(at(four, 5, 12)).toBe(COFFEE);
    expect(at(four, 5, 9)).toBe(CREMA);
    expect(at(four, 5, 8)).toBe(EMPTY);
  });

  it('is brim full at level 1', () => {
    const full = cupFillPixels(1);
    expect(at(full, 5, 6)).toBe(CREMA);
    expect(full.some((p) => p.fill === EMPTY)).toBe(false);
  });

  it('never fills the handle', () => {
    expect(at(cupFillPixels(1), 13, 8)).toBeUndefined();
    expect(CUP_FILL_ROWS).toBe(7);
  });
});
