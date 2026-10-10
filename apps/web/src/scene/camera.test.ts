import { afterEach, describe, expect, it } from 'vitest';
import { cats, crew } from './fixtures';
import { renderScene, SCENE_H, SCENE_W, loftAlpha, wallAlpha } from './building';
import { depth, faceVisible, iso, quarter, setCameraAngle, turn, unturn, viewFace } from './iso';
import { Raster } from './raster';

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
