import { afterEach, describe, expect, it } from 'vitest';
import { BUILDING, FLOORS, GROUND } from '@/sim/layout';
import { outfitFor } from './avatar';
import { cats, crew } from './fixtures';
import { inside, renderScene, SCENE_H, SCENE_W, loftAlpha, wallAlpha } from './building';
import { depth, faceVisible, iso, quarter, setCameraAngle, turn, unturn, viewFace } from './iso';
import { Raster } from './raster';
import { agentLook, agentSprite } from './sprites';

const Q = Math.PI / 2;
afterEach(() => setCameraAngle(0));

describe('camera', () => {
  it('is the plain projection at angle 0', () => {
    setCameraAngle(0);
    const P = iso(222, 145);
    for (const [x, y, z] of [[0, 0, 0], [3.3, 7.1, 12], [14, 11, 62], [19.5, 16.2, -2]] as const) {
      expect(P(x, y, z)).toEqual([Math.round(222 + (x - y) * 12), Math.round(145 + (x + y) * 6 - z)]);
      expect(depth(x, y)).toBe(x + y);
    }
  });

  it('comes back round after four quarter turns', () => {
    let p: [number, number] = [3.25, 7.5];
    for (let i = 0; i < 4; i++) {
      setCameraAngle(Q);
      p = turn(...p);
    }
    expect(p[0]).toBeCloseTo(3.25, 9);
    expect(p[1]).toBeCloseTo(7.5, 9);
  });

  it('undoes its own turn', () => {
    setCameraAngle(0.7);
    const [x, y] = unturn(...turn(4.5, 12.25));
    expect(x).toBeCloseTo(4.5, 9);
    expect(y).toBeCloseTo(12.25, 9);
  });

  it('keeps the plot centre in place', () => {
    const P0 = (setCameraAngle(0), iso(222, 145))(10, 8.5);
    for (const a of [Q, Math.PI, -Q, 0.4]) {
      setCameraAngle(a);
      expect(iso(222, 145)(10, 8.5)).toEqual(P0);
    }
  });

  it('shows the two faces toward the viewer at each quarter', () => {
    const shown = () => (['x+', 'y+', 'x-', 'y-'] as const).filter((f) => {
      const n = { 'x+': [1, 0], 'y+': [0, 1], 'x-': [-1, 0], 'y-': [0, -1] }[f] as [number, number];
      return faceVisible(...n);
    });
    setCameraAngle(0);
    expect(shown()).toEqual(['x+', 'y+']);
    setCameraAngle(Q);
    expect(shown()).toEqual(['x+', 'y-']);
    setCameraAngle(Math.PI);
    expect(shown()).toEqual(['x-', 'y-']);
    setCameraAngle(-Q);
    expect(shown()).toEqual(['y+', 'x-']);
  });

  it('turns sprite facings with the camera', () => {
    setCameraAngle(0);
    expect(quarter()).toBe(0);
    expect(viewFace('x+')).toBe('x+');
    setCameraAngle(Q);
    expect(viewFace('x+')).toBe('y+');
    expect(viewFace('y-')).toBe('x+');
    setCameraAngle(Math.PI);
    expect(viewFace('x+')).toBe('x-');
    setCameraAngle(-Q);
    expect(quarter()).toBe(3);
    expect(viewFace('x+')).toBe('y-');
  });
});

describe('walls and the loft', () => {
  const shownWalls = (a: number) => {
    setCameraAngle(a);
    return (['L', 'R', 'F', 'E'] as const).filter((s) => wallAlpha(s) > 0.99);
  };

  it('draws the two far sides of the building from each quarter', () => {
    expect(shownWalls(0)).toEqual(['L', 'R']);
    expect(shownWalls(Q)).toEqual(['L', 'F']);
    expect(shownWalls(Math.PI)).toEqual(['F', 'E']);
    expect(shownWalls(-Q)).toEqual(['R', 'E']);
  });

  it('fades the loft as it comes round to the front', () => {
    setCameraAngle(0);
    expect(loftAlpha()).toBe(1);
    setCameraAngle(Q);
    const side = loftAlpha();
    setCameraAngle(Math.PI);
    expect(loftAlpha()).toBeCloseTo(0.5, 6);
    expect(side).toBeGreaterThan(0.5);
    expect(side).toBeLessThan(1);
  });
});

describe('renderScene', () => {
  it('reports where every agent and cat was drawn, from any side', () => {
    for (const angle of [0, Q, Math.PI, -Q, Q / 2]) {
      const hits = renderScene(new Raster(SCENE_W, SCENE_H), crew, { theme: 'day', t: 3, cats, angle });
      expect(hits.agents.map((h) => h.id).sort()).toEqual(crew.map((a) => a.id).sort());
      expect(hits.cats.map((h) => h.id).sort()).toEqual(cats.map((c) => c.id).sort());
    }
  });

  it("outlines the café on screen from any side, and leaves the sky out", () => {
    for (const angle of [0, Q, Math.PI, -Q, Q / 2]) {
      const { outline, agents } = renderScene(new Raster(SCENE_W, SCENE_H), crew, { theme: 'day', t: 3, cats, angle });
      setCameraAngle(angle);
      const [cx, cy] = iso(222, 145)(10, 8.5); // the plot's centre
      expect(inside(outline, cx, cy)).toBe(true);
      for (const a of agents) expect(inside(outline, a.headX, a.headY)).toBe(true);
      expect(inside(outline, 2, 2)).toBe(false);
      expect(inside(outline, SCENE_W - 2, 2)).toBe(false);
    }
  });

  it('keeps the nook in front of ground-floor things behind it, seen from behind', () => {
    // From behind (180°) the nook under the loft is the nearest corner. A pendant hangs
    // there; an agent far behind it lines up with the bulb on screen.
    const pendant = GROUND.props.find((p) => p.kind === 'pendant')!;
    const far = { id: 'far', name: 'Far', providerId: 'openai' as const, x: pendant.x + 2.5, y: pendant.y + 2.5, face: 'y+' as const, pose: 'stand' as const, t: 0, bubble: null, spriteSeed: 3, demo: false };
    const draw = (who: typeof far[]) => {
      const R = new Raster(SCENE_W, SCENE_H);
      renderScene(R, who, { theme: 'day', t: 3, angle: Math.PI, labels: false });
      return R;
    };
    const without = draw([]), withFar = draw([far]);
    setCameraAngle(Math.PI);
    const bulb = iso(222, 145)(pendant.x, pendant.y, BUILDING.H1 - 20);
    const at = (R: Raster) => Array.from(R.d.subarray(((bulb[1] + 2) * R.w + bulb[0]) * 4, ((bulb[1] + 2) * R.w + bulb[0]) * 4 + 4));
    expect(depth(far.x, far.y)).toBeLessThan(depth(pendant.x, pendant.y)); // really behind it
    expect(at(withFar)).toEqual(at(without));
  });

  it('lets loft furniture hide the agents behind it, even while the loft is see-through', () => {
    // From 270° the desks are nearer than the chairs behind them.
    const seat = FLOORS.anthropic.seats[0]!;
    const agent = { id: 'a', name: 'A', providerId: 'anthropic' as const, x: seat.x, y: seat.y, face: 'y+' as const, pose: 'stand' as const, t: 0, bubble: null, spriteSeed: 3, demo: false };
    const draw = (who: typeof agent[]) => {
      const R = new Raster(SCENE_W, SCENE_H);
      renderScene(R, who, { theme: 'day', t: 3, angle: -Q, labels: false });
      return R;
    };
    // Pixels the agent changes = the part of them you can see.
    const a = draw([agent]), b = draw([]);
    let seen = 0;
    for (let i = 0; i < a.d.length; i += 4) if (a.d[i] !== b.d[i] || a.d[i + 1] !== b.d[i + 1] || a.d[i + 2] !== b.d[i + 2]) seen++;
    // The whole sprite, for comparison: drawn over everything, every one of these would show.
    const { grid, palette } = agentSprite('stand', agentLook(agent.spriteSeed, outfitFor('anthropic')));
    const whole = grid.reduce((s, row) => s + [...row].filter((ch) => palette[ch]).length, 0);
    setCameraAngle(-Q);
    expect(loftAlpha()).toBeLessThan(1); // the loft really is see-through from here
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(whole * 0.85); // the desk hides a good part of them
  });

  it('floats hearts over a cat just after it is petted', () => {
    const draw = (petted?: Map<string, number>) => {
      const R = new Raster(SCENE_W, SCENE_H);
      renderScene(R, crew, { theme: 'day', t: 3, cats, petted });
      return R.d;
    };
    const plain = draw(), petted = draw(new Map([['marmalade', 2.6]])), later = draw(new Map([['marmalade', -5]]));
    expect(petted).not.toEqual(plain);
    expect(later).toEqual(plain);
  });
});
