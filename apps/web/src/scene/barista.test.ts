import { describe, expect, it } from 'vitest';
import { GROUND } from '@/sim/layout';
import { baristaAt } from './barista';

const counter = GROUND.props.find((p) => p.kind === 'cafeCounter')!;
const backbar = GROUND.props.find((p) => p.kind === 'backbar')!;

describe('barista', () => {
  const times = Array.from({ length: 400 }, (_, i) => i * 0.25);

  it('stays behind the counter, between it and the back bar', () => {
    for (const t of times) {
      const s = baristaAt(t);
      expect(s.y).toBeGreaterThan(backbar.y + backbar.d);
      expect(s.y).toBeLessThan(counter.y);
      expect(s.x).toBeGreaterThanOrEqual(counter.x);
      expect(s.x).toBeLessThanOrEqual(counter.x + counter.w);
    }
  });

  it('is a pure function of time', () => {
    for (const t of times) expect(baristaAt(t)).toEqual(baristaAt(t));
  });

  it('makes a cup, carries it, then leaves it out', () => {
    const states = times.map(baristaAt);
    expect(states.some((s) => s.act === 'brew')).toBe(true);
    expect(states.some((s) => s.carrying)).toBe(true);
    expect(states.some((s) => s.cupOut)).toBe(true);
    expect(states.some((s) => s.carrying && s.cupOut)).toBe(false);
  });
});
