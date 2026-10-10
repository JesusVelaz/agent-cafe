import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readViewAngle, useCafe } from './cafe';

describe('view angle', () => {
  let saved: Record<string, string>;
  beforeEach(() => {
    saved = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v; } });
    useCafe.setState({ viewAngle: 0 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('turns a quarter at a time, round and round', () => {
    const { turnView } = useCafe.getState();
    turnView(1);
    expect(useCafe.getState().viewAngle).toBe(1);
    turnView(-1);
    turnView(-1);
    expect(useCafe.getState().viewAngle).toBe(3);
    for (let i = 0; i < 4; i++) turnView(1);
    expect(useCafe.getState().viewAngle).toBe(3);
  });

  it('is remembered in this browser', () => {
    useCafe.getState().setViewAngle(6);
    expect(useCafe.getState().viewAngle).toBe(2);
    expect(readViewAngle()).toBe(2);
  });

  it('starts from the street corner when nothing (or nonsense) was saved', () => {
    expect(readViewAngle()).toBe(0);
    saved['cafe.viewAngle'] = 'sideways';
    expect(readViewAngle()).toBe(0);
  });
});
