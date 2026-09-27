/**
 * Builds the static scenery for one floor: floor, walls, wall decor (base layer)
 * and furniture (depth-sorted pieces). Furniture is emitted per tile so agents
 * sort correctly in front of and behind multi-tile counters.
 */
import { Container, Graphics, Sprite } from 'pixi.js';
import { FLOOR_D, FLOOR_W, type FloorLayout, type Prop, type WallDecor } from '@/sim/layout';
import { box, floorQuad, isoEllipse, poly, proj, wallPoint, wallRect, WALL_H, type Origin } from './iso';
import { C, shade } from './palette';
import { drawText, textWidth } from './pixelFont';
import type { SpriteRegistry } from './registry';

/** Sort key for something standing on tile (x, y). Agents use the same scale. */
export const depthOf = (x: number, y: number, bias = 5) => (x + y) * 10 + bias;

export interface Piece {
  node: Container;
  depth: number;
}

export interface FloorScenery {
  base: Container;
  pieces: Piece[];
  /** Blinking server-rack LEDs; the renderer toggles them. */
  leds: Graphics[];
}

const WALL_T = 0.22; // wall thickness in tiles (visible at the cutaway ends)

// A tiny deterministic hash for per-tile variation (plank shades, book colours).
const hash = (a: number, b: number, c = 0) => {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export function buildFloor(layout: FloorLayout, o: Origin, reg: SpriteRegistry): FloorScenery {
  const base = new Container();
  const g = new Graphics();
  base.addChild(g);
  const loft = layout.id === 'anthropic';

  // Slab under the floor (visible as a thick edge along the open front).
  box(g, o, 0, 0, -9, FLOOR_W, FLOOR_D, 9, { color: C.wallCap, top: C.wallCap });

  // Floor.
  for (let x = 0; x < FLOOR_W; x++) {
    for (let y = 0; y < FLOOR_D; y++) {
      if (loft) {
        // Floorboards running along x, two planks per tile, staggered shades.
        for (let half = 0; half < 2; half++) {
          const r = hash(x >> 1, y * 2 + half, 3);
          const col = r < 0.33 ? C.plankDark : r < 0.66 ? C.plank : C.plankLight;
          floorQuad(g, o, x, y + half * 0.5, 1, 0.5, col);
        }
      } else {
        floorQuad(g, o, x, y, 1, 1, (x + y) % 2 === 0 ? C.cream : C.navy);
      }
    }
  }

  drawWalls(g, o, loft);
  for (const d of layout.decor) drawDecor(base, g, o, d, reg);

  // Floor-level props (rugs, mats) go in the base layer; everything else is sorted.
  const pieces: Piece[] = [];
  const leds: Graphics[] = [];
  for (const prop of layout.props) {
    if (prop.kind === 'rug' || (prop.kind === 'backbar' && prop.variant === 'floor')) {
      drawFlat(g, o, prop, loft);
      continue;
    }
    pieces.push(...drawProp(o, prop, reg, leds, layout));
  }
  return { base, pieces, leds };
}

// ── Walls ────────────────────────────────────────────────────────────────────

function drawWalls(g: Graphics, o: Origin, loft: boolean) {
  const wall = loft ? C.loftWall : C.wall;
  const wains = loft ? C.loftWainscot : C.wainscot;
  const WAIN = 18;

  // Left wall (x = 0), seen from inside; slightly darker than the right wall.
  wallRect(g, o, 'left', 0, FLOOR_D, 0, WALL_H, shade(wall, -0.08));
  wallRect(g, o, 'left', 0, FLOOR_D, 0, WAIN, shade(wains, -0.08));
  wallRect(g, o, 'left', 0, FLOOR_D, WAIN, WAIN + 2, C.trim);
  wallRect(g, o, 'left', 0, FLOOR_D, 0, 2, shade(C.trim, -0.2));
  // Right wall (y = 0).
  wallRect(g, o, 'right', 0, FLOOR_W, 0, WALL_H, wall);
  wallRect(g, o, 'right', 0, FLOOR_W, 0, WAIN, wains);
  wallRect(g, o, 'right', 0, FLOOR_W, WAIN, WAIN + 2, C.trim);
  wallRect(g, o, 'right', 0, FLOOR_W, 0, 2, shade(C.trim, -0.2));

  // Top caps and cut ends give the walls thickness, like a diorama.
  const cap = C.wallCap;
  poly(g, [proj(o, -WALL_T, -WALL_T, WALL_H), proj(o, FLOOR_W, -WALL_T, WALL_H), proj(o, FLOOR_W, 0, WALL_H), proj(o, 0, 0, WALL_H)], shade(cap, 0.15));
  poly(g, [proj(o, -WALL_T, -WALL_T, WALL_H), proj(o, 0, 0, WALL_H), proj(o, 0, FLOOR_D, WALL_H), proj(o, -WALL_T, FLOOR_D, WALL_H)], shade(cap, 0.15));
  // End of left wall (at y = D), facing the viewer.
  poly(g, [proj(o, -WALL_T, FLOOR_D, WALL_H), proj(o, 0, FLOOR_D, WALL_H), proj(o, 0, FLOOR_D, -9), proj(o, -WALL_T, FLOOR_D, -9)], cap);
  // End of right wall (at x = W).
  poly(g, [proj(o, FLOOR_W, -WALL_T, WALL_H), proj(o, FLOOR_W, 0, WALL_H), proj(o, FLOOR_W, 0, -9), proj(o, FLOOR_W, -WALL_T, -9)], shade(cap, -0.25));
}

function drawDecor(base: Container, g: Graphics, o: Origin, d: WallDecor, reg: SpriteRegistry) {
  const u0 = d.at;
  const u1 = d.at + d.span;
  const slope = d.wall === 'right' ? 0.5 : -0.5;
  // Text reads left→right on screen: along +u on the right wall, along -u on the left.
  const textAt = (uStart: number, uEnd: number, v: number, text: string, scale = 1) => {
    const mid = (uStart + uEnd) / 2;
    const w = textWidth(text, scale);
    const p = wallPoint(o, d.wall, mid, v);
    // Centre horizontally, compensating for the slope.
    return { x: p.x - Math.round(w / 2), y: p.y - Math.round((w / 2) * slope) };
  };

  switch (d.kind) {
    case 'door': {
      wallRect(g, o, d.wall, u0 + 0.1, u1 - 0.1, 0, 38, C.walnutDark);
      wallRect(g, o, d.wall, u0 + 0.18, u1 - 0.18, 2, 36, C.walnut);
      wallRect(g, o, d.wall, u0 + 0.3, u1 - 0.3, 22, 32, C.glass);
      const k = wallPoint(o, d.wall, u0 + 0.75, 18);
      g.rect(k.x, k.y, 2, 2).fill(C.brass);
      break;
    }
    case 'window': {
      wallRect(g, o, d.wall, u0 + 0.1, u1 - 0.1, 24, 50, C.walnutDark);
      wallRect(g, o, d.wall, u0 + 0.18, u1 - 0.18, 26, 48, C.glass);
      wallRect(g, o, d.wall, u0 + 0.18, u1 - 0.18, 26, 30, C.glassDark);
      if (d.label) {
        const t = textAt(u0, u1, 44, d.label);
        drawText(g, d.label, t.x, t.y, { color: C.white, slope });
      }
      break;
    }
    case 'menu': {
      wallRect(g, o, d.wall, u0 + 0.05, u1 - 0.05, 22, 52, C.walnutDark);
      wallRect(g, o, d.wall, u0 + 0.12, u1 - 0.12, 24, 50, C.chalkboard);
      const t = textAt(u0, u1, 47, d.label ?? 'MENU');
      drawText(g, d.label ?? 'MENU', t.x, t.y, { color: C.chalk, slope });
      // Chalk price lines.
      for (let i = 0; i < 3; i++) {
        const a = wallPoint(o, d.wall, u0 + 0.4, 38 - i * 5);
        const b = wallPoint(o, d.wall, u1 - 0.9, 38 - i * 5);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: C.chalk, alpha: 0.55 });
        const pr = wallPoint(o, d.wall, u1 - 0.55, 38 - i * 5);
        g.rect(pr.x, pr.y - 1, 2, 2).fill(C.amber);
      }
      break;
    }
    case 'clock': {
      const p = wallPoint(o, d.wall, (u0 + u1) / 2, 44);
      const s = new Sprite(reg.clock());
      s.anchor.set(0.5);
      s.position.set(p.x, p.y);
      base.addChild(s);
      break;
    }
    case 'ticketRail': {
      wallRect(g, o, d.wall, u0, u1, 40, 42, C.metal);
      wallRect(g, o, d.wall, u0, u1, 39, 40, C.metalDark);
      break;
    }
    case 'corkboard': {
      wallRect(g, o, d.wall, u0 + 0.05, u1 - 0.05, 22, 46, C.walnutDark);
      wallRect(g, o, d.wall, u0 + 0.12, u1 - 0.12, 24, 44, C.cork);
      break;
    }
    case 'poster': {
      wallRect(g, o, d.wall, u0 + 0.2, u1 - 0.2, 28, 46, C.cream);
      wallRect(g, o, d.wall, u0 + 0.3, u1 - 0.3, 34, 43, d.wall === 'left' ? C.coral : C.wainscot);
      break;
    }
    case 'sign': {
      wallRect(g, o, d.wall, u0 + 0.1, u1 - 0.1, 36, 46, C.walnutDark);
      if (d.label) {
        const t = textAt(u0, u1, 43.5, d.label);
        drawText(g, d.label, t.x, t.y, { color: C.brass, slope });
      }
      break;
    }
  }
}

// ── Props ────────────────────────────────────────────────────────────────────

function drawFlat(g: Graphics, o: Origin, p: Prop, loft: boolean) {
  if (p.kind === 'backbar') {
    floorQuad(g, o, p.x, p.y, 1, 1, '#3b3f45');
    return;
  }
  // Rug: bordered, 2×2 downstairs (door mat) or 3×2 in the loft.
  const w = loft ? 3 : 1;
  const d = loft ? 2 : 2;
  floorQuad(g, o, p.x, p.y, w, d, loft ? '#7a3b3b' : '#6b4a3a');
  floorQuad(g, o, p.x + 0.15, p.y + 0.15, w - 0.3, d - 0.3, loft ? '#a55a4a' : '#8a6448');
  floorQuad(g, o, p.x + 0.35, p.y + 0.35, w - 0.7, d - 0.7, loft ? '#d9a441' : '#6b4a3a');
}

/** Rect on the vertical plane x = X (spanning y) or y = Y (spanning x). */
function faceRect(
  g: Graphics,
  o: Origin,
  plane: { x: number } | { y: number },
  a0: number,
  a1: number,
  v0: number,
  v1: number,
  color: string,
) {
  const at = (a: number, v: number) => ('x' in plane ? proj(o, plane.x, a, v) : proj(o, a, plane.y, v));
  poly(g, [at(a0, v1), at(a1, v1), at(a1, v0), at(a0, v0)], color);
}

const BOOK_COLOURS = ['#b5483f', '#4f7fae', '#d9a441', '#5c8f5a', '#8a6fb8', '#e8dcc0', '#3f5f6b'];

function piece(x: number, y: number, bias = 5): { g: Graphics; piece: Piece } {
  const node = new Container();
  const g = new Graphics();
  node.addChild(g);
  return { g, piece: { node, depth: depthOf(x, y, bias) } };
}

function drawProp(o: Origin, p: Prop, reg: SpriteRegistry, leds: Graphics[], layout: FloorLayout): Piece[] {
  const { x, y } = p;
  const main = piece(x, y);
  const g = main.g;
  const out: Piece[] = [main.piece];

  const counterBody = (color: string, top: string) => {
    box(g, o, x, y + 0.15, 0, 1, 0.7, 15, color);
    box(g, o, x - 0.02, y + 0.1, 15, 1.04, 0.8, 2, { color: shade(top, -0.1), top });
    // Front panel groove.
    faceRect(g, o, { y: y + 0.85 }, x + 0.1, x + 0.9, 4, 11, shade(color, -0.12));
  };

  switch (p.kind) {
    case 'backbar': {
      box(g, o, x, y, 0, 1, 0.45, 13, C.walnutDark);
      // Wall shelf with jars and bottles.
      wallRect(g, o, 'right', x, x + 1, 33, 35, C.walnut);
      for (let i = 0; i < 3; i++) {
        const r = hash(x, i, 7);
        const col = BOOK_COLOURS[Math.floor(r * BOOK_COLOURS.length)]!;
        box(g, o, x + 0.12 + i * 0.28, 0.08, 13, 0.14, 0.14, 5 + Math.round(r * 4), col);
        box(g, o, x + 0.2 + i * 0.28, 0.02, 35, 0.14, 0.1, 5, i % 2 ? C.glass : C.cream);
      }
      break;
    }
    case 'counter':
      counterBody(C.walnut, C.countertop);
      break;
    case 'espresso':
      counterBody(C.walnut, C.countertop);
      box(g, o, x + 0.15, y + 0.25, 17, 0.65, 0.45, 11, { color: C.metal, top: '#d7dde2' });
      box(g, o, x + 0.2, y + 0.55, 20, 0.2, 0.2, 3, C.metalDark);
      g.rect(proj(o, x + 0.6, y + 0.7, 25).x, proj(o, x + 0.6, y + 0.7, 25).y, 1, 1).fill(C.red);
      break;
    case 'register':
      counterBody(C.walnut, C.countertop);
      box(g, o, x + 0.25, y + 0.3, 17, 0.5, 0.4, 5, C.ink);
      box(g, o, x + 0.3, y + 0.3, 22, 0.35, 0.08, 5, { color: C.screenDim, top: C.screen });
      break;
    case 'pickup':
      counterBody(C.walnutLight, C.marble);
      break;
    case 'table': {
      box(g, o, x + 0.42, y + 0.42, 0, 0.16, 0.16, 10, C.walnutDark);
      isoEllipse(g, o, x + 0.5, y + 0.5, 0.44, 10, C.walnutDark);
      isoEllipse(g, o, x + 0.5, y + 0.5, 0.44, 12, C.walnutLight);
      // Laptop, open toward the agent on the left seat.
      box(g, o, x + 0.3, y + 0.3, 12, 0.34, 0.36, 1, C.metal);
      box(g, o, x + 0.62, y + 0.3, 13, 0.05, 0.36, 7, { color: C.metalDark, right: C.screenDim });
      break;
    }
    case 'chair': {
      const face = p.variant ?? 'x+';
      box(g, o, x + 0.28, y + 0.28, 0, 0.44, 0.44, 7, C.walnut);
      const back = face === 'x+' ? [x + 0.22, y + 0.28, 0.07, 0.44] : face === 'y+' ? [x + 0.28, y + 0.22, 0.44, 0.07] : null;
      if (back) {
        box(g, o, back[0]!, back[1]!, 7, back[2]!, back[3]!, 10, C.walnutDark);
      } else {
        // Backrest on the viewer's side: sorts in front of the seated agent.
        const front = piece(x, y, 8);
        box(front.g, o, x + 0.72, y + 0.28, 7, 0.07, 0.44, 10, C.walnutDark);
        out.push(front.piece);
      }
      break;
    }
    case 'desk': {
      box(g, o, x + 0.08, y + 0.12, 0, 0.84, 0.72, 12, { color: C.walnut, top: C.walnutLight });
      // Monitor back faces the viewer; the agent sits behind it.
      box(g, o, x + 0.28, y + 0.22, 12, 0.44, 0.08, 7, C.ink);
      box(g, o, x + 0.46, y + 0.32, 12, 0.08, 0.08, 2, C.metalDark);
      box(g, o, x + 0.72, y + 0.5, 12, 0.12, 0.12, 3, C.white);
      break;
    }
    case 'bookcase': {
      const onLeft = x === 0;
      if (onLeft) box(g, o, x + 0.05, y, 0, 0.45, 1, 34, C.walnutDark);
      else box(g, o, x, y + 0.02, 0, 1, 0.45, 34, C.walnutDark);
      const plane = onLeft ? { x: x + 0.5 } : { y: y + 0.47 };
      const a0 = onLeft ? y : x;
      for (let shelf = 0; shelf < 3; shelf++) {
        const v0 = 3 + shelf * 10;
        faceRect(g, o, plane, a0 + 0.05, a0 + 0.95, v0 - 1, v0, C.walnut);
        let a = a0 + 0.08;
        let i = 0;
        while (a < a0 + 0.9) {
          const r = hash(x * 7 + y, shelf, i++);
          const w = 0.08 + r * 0.06;
          const col = BOOK_COLOURS[Math.floor(r * BOOK_COLOURS.length)]!;
          faceRect(g, o, plane, a, Math.min(a + w, a0 + 0.92), v0, v0 + 6 + Math.round(r * 2), col);
          a += w + 0.02;
        }
      }
      break;
    }
    case 'cabinet': {
      box(g, o, x + 0.08, y + 0.15, 0, 0.42, 0.7, 22, { color: C.metal, right: C.metalDark });
      for (let i = 0; i < 3; i++) {
        faceRect(g, o, { x: x + 0.5 }, y + 0.2, y + 0.8, 3 + i * 7, 4 + i * 7, C.metalDark);
        faceRect(g, o, { x: x + 0.5 }, y + 0.42, y + 0.58, 6 + i * 7, 7 + i * 7, C.ink);
      }
      break;
    }
    case 'archive': {
      box(g, o, x, y + 0.02, 0, 1, 0.45, 32, C.walnut);
      for (let shelf = 0; shelf < 3; shelf++) {
        const v0 = 3 + shelf * 10;
        for (let i = 0; i < 3; i++) {
          const col = hash(x, shelf, i) > 0.5 ? '#c9a06a' : '#b98d58';
          faceRect(g, o, { y: y + 0.47 }, x + 0.08 + i * 0.3, x + 0.32 + i * 0.3, v0, v0 + 7, col);
          faceRect(g, o, { y: y + 0.47 }, x + 0.16 + i * 0.3, x + 0.24 + i * 0.3, v0 + 3, v0 + 4, C.cream);
        }
      }
      break;
    }
    case 'ledger': {
      box(g, o, x + 0.05, y + 0.1, 0, 0.6, 0.8, 12, { color: C.walnut, top: C.walnutLight });
      box(g, o, x + 0.15, y + 0.3, 12, 0.35, 0.4, 4, C.metalDark);
      box(g, o, x + 0.15, y + 0.3, 16, 0.12, 0.4, 3, C.cream);
      break;
    }
    case 'plant': {
      box(g, o, x + 0.3, y + 0.3, 0, 0.4, 0.4, 8, C.pot);
      const s = new Sprite(reg.plant());
      s.anchor.set(0.5, 1);
      const at = proj(o, x + 0.5, y + 0.5, 8);
      s.position.set(at.x, at.y + 1);
      main.piece.node.addChild(s);
      break;
    }
    case 'rack': {
      box(g, o, x + 0.05, y + 0.05, 0, 0.9, 0.5, 40, { color: '#2f3640', top: '#454e5a' });
      const led = new Graphics();
      for (let i = 0; i < 6; i++) {
        const p0 = proj(o, x + 0.2 + (i % 3) * 0.25, y + 0.55, 10 + Math.floor(i / 3) * 14);
        led.rect(p0.x, p0.y, 1, 1).fill(i % 2 ? C.mint : C.amber);
      }
      main.piece.node.addChild(led);
      leds.push(led);
      break;
    }
    case 'outbox':
      counterBody(C.walnutLight, C.marble);
      break;
    case 'stairs': {
      // Drawn once, from the front-most stair tile, so steps never interleave.
      const stairs = layout.props.filter((q) => q.kind === 'stairs');
      const maxX = Math.max(...stairs.map((q) => q.x));
      const maxY = Math.max(...stairs.map((q) => q.y));
      if (x !== maxX || y !== maxY) return [];
      const x0 = Math.min(...stairs.map((q) => q.x));
      const y0 = Math.min(...stairs.map((q) => q.y));
      const w = maxX + 1 - x0;
      const d = maxY + 1 - y0;
      if (layout.id === 'openai') {
        // Steps climb toward the back wall; each one is shallower than the last.
        const steps = 7;
        for (let i = 0; i < steps; i++) {
          const depth = d / steps;
          box(g, o, x0, y0, i * 6, w, d - i * depth, 6, i % 2 ? C.walnut : C.walnutLight);
        }
      } else {
        // Loft: stairwell opening with a railing.
        floorQuad(g, o, x0, y0, w, d, '#2a2320');
        for (let i = 0; i < 3; i++) box(g, o, x0 + 0.1, y0 + 0.2 + i * 0.5, -6 - i * 6, w - 0.2, 0.5, 2, C.walnut);
        box(g, o, x0 - 0.05, y0 - 0.05, 0, 0.08, d + 0.05, 14, C.walnutDark);
        box(g, o, x0 - 0.05, y0 - 0.05, 0, w + 0.05, 0.08, 14, C.walnutDark);
        box(g, o, x0 - 0.05, y0 - 0.05, 14, 0.1, d + 0.05, 2, C.walnutLight);
        box(g, o, x0 - 0.05, y0 - 0.05, 14, w + 0.05, 0.1, 2, C.walnutLight);
      }
      break;
    }
    case 'rug':
      break;
  }
  return out;
}
