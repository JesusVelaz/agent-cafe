import { describe, expect, it } from 'vitest';
import { approach, fillGoal, MARKS } from './loader';

describe('the first-load fill', () => {
  it('rests on a mark for each step that has landed', () => {
    expect(fillGoal(0, 0)).toBe(MARKS[0]);
    expect(fillGoal(2, 0)).toBe(MARKS[2]);
    expect(fillGoal(3, 0)).toBe(1);
  });

  it('creeps toward the next mark while waiting, but never reaches it', () => {
    const early = fillGoal(1, 300);
    const late = fillGoal(1, 60_000);
    expect(early).toBeGreaterThan(MARKS[1]);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThan(MARKS[2]);
  });

  it('eases toward the goal and never overshoots', () => {
    let p = 0;
    for (let i = 0; i < 200; i++) p = approach(p, 1, 16);
    expect(p).toBeGreaterThan(0.99);
    expect(p).toBeLessThanOrEqual(1);
    expect(approach(0.5, 0.5, 16)).toBe(0.5);
  });
});
