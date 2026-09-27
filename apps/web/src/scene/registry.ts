/**
 * SpriteRegistry: grid → Texture, cached. The single seam between the pixel-art
 * data and the GPU. A future sprite-sheet swap only needs to reimplement this.
 */
import { Texture } from 'pixi.js';
import { C, HAIR, PANTS, SHIRT, SKIN, shade } from './palette';
import {
  AGENT_BACK,
  AGENT_FRONT,
  CUP,
  CUP_FAILED,
  ICONS,
  PLANT,
  TICKET,
  WALL_CLOCK,
  withApron,
  type AgentFrame,
  type Grid,
  type IconName,
} from './sprites';

type Palette = Record<string, string>;

const BASE: Palette = {
  o: C.ink,
  k: C.ink,
  w: C.white,
  e: C.ink,
  b: '#3a2a22',
  a: C.cream,
  A: C.creamShade,
  g: '#3c9a5f',
  r: C.red,
  y: C.amber,
  n: C.cream,
  l: C.leaf,
  L: C.leafDark,
};

function gridToCanvas(grid: Grid, palette: Palette): HTMLCanvasElement {
  const h = grid.length;
  const w = Math.max(...grid.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]!];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return canvas;
}

function makeTexture(grid: Grid, palette: Palette): Texture {
  const tex = Texture.from(gridToCanvas(grid, palette));
  tex.source.scaleMode = 'nearest';
  return tex;
}

/** Deterministic look from an agent's spriteSeed. */
export function agentLook(seed: number) {
  let a = seed >>> 0;
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  return { hair: pick(HAIR), skin: pick(SKIN), shirt: pick(SHIRT), pants: pick(PANTS) };
}

export type AgentTextures = Record<'front' | 'back', Record<AgentFrame, Texture>>;

const SEATED: ReadonlySet<AgentFrame> = new Set(['sit', 'typeA', 'typeB', 'slump']);

export class SpriteRegistry {
  private cache = new Map<string, Texture>();
  private agents = new Map<string, AgentTextures>();

  agent(seed: number, demo: boolean): AgentTextures {
    const key = `${seed}:${demo}`;
    const hit = this.agents.get(key);
    if (hit) return hit;
    const look = agentLook(seed);
    const pal: Palette = {
      ...BASE,
      h: look.hair,
      H: shade(look.hair, -0.25),
      s: look.skin,
      S: shade(look.skin, -0.18),
      c: look.shirt,
      C: shade(look.shirt, -0.22),
      p: look.pants,
    };
    const build = (set: Record<AgentFrame, Grid>, front: boolean) =>
      Object.fromEntries(
        (Object.keys(set) as AgentFrame[]).map((f) => {
          const grid = demo && front ? withApron(set[f], SEATED.has(f)) : set[f];
          return [f, makeTexture(grid, pal)];
        }),
      ) as Record<AgentFrame, Texture>;
    const textures = { front: build(AGENT_FRONT, true), back: build(AGENT_BACK, false) };
    this.agents.set(key, textures);
    return textures;
  }

  icon(name: IconName): Texture {
    return this.get(`icon:${name}`, ICONS[name], { ...BASE, b: '#5d7fb8', n: C.walnut });
  }

  plant(): Texture {
    return this.get('plant', PLANT, BASE);
  }
  clock(): Texture {
    return this.get('clock', WALL_CLOCK, BASE);
  }
  cup(failed: boolean): Texture {
    return failed ? this.get('cup:failed', CUP_FAILED, BASE) : this.get('cup', CUP, { ...BASE, k: C.metalDark });
  }
  ticket(): Texture {
    return this.get('ticket', TICKET, { ...BASE, k: C.metalDark });
  }

  private get(key: string, grid: Grid, palette: Palette): Texture {
    let tex = this.cache.get(key);
    if (!tex) {
      tex = makeTexture(grid, palette);
      this.cache.set(key, tex);
    }
    return tex;
  }

  destroy() {
    for (const t of this.cache.values()) t.destroy(true);
    for (const set of this.agents.values()) {
      for (const view of Object.values(set)) for (const t of Object.values(view)) t.destroy(true);
    }
    this.cache.clear();
    this.agents.clear();
  }
}
