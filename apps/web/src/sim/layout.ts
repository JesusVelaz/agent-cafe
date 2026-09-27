/**
 * The café building as pure data. The simulation paths over it and the renderer
 * draws it, so they can never disagree about where anything is.
 *
 * Coordinates are continuous tile units. x runs toward the screen's lower-right,
 * y toward the lower-left. Back walls sit along x = 0 (left wall) and y = 0
 * (right wall); the front edges are open (diorama cutaway). Heights (z, v) are
 * in scene pixels.
 *
 * The building is "stacked, set back": the upper floor sits directly on top of
 * the ground floor, one step smaller, so the café shows around it. Anything
 * under the upper floor is only visible through the gap between floors, so only
 * low furniture goes there (visible if height < 56 − (6 − y)·6).
 *
 * Adding a provider = adding another set-back story here.
 */
import type { ProviderId } from '@agent-cafe/shared';

export const BUILDING = {
  /** Ground floor footprint. */
  W: 14,
  D: 11,
  /** Ground story height (px); the upper floor's surface sits at this z. */
  H1: 62,
  /** Upper floor footprint (from the back corner). */
  UW: 9,
  UD: 6,
  /** Upper story wall height (px). */
  H2: 48,
} as const;

export type Dir = 'x+' | 'x-' | 'y+' | 'y-';
export interface Pt {
  x: number;
  y: number;
}
export interface Spot extends Pt {
  /** Direction the agent faces while here. */
  face: Dir;
}

/** Stations agents walk to. Tools map onto these (see activity.ts). */
export type StationId = 'register' | 'clock' | 'bookcase' | 'archive' | 'pickup';

export type PropKind =
  | 'backbar'
  | 'cafeCounter'
  | 'bookshelf'
  | 'archive'
  | 'cabinet'
  | 'windowBar'
  | 'stool'
  | 'coatRack'
  | 'umbrellas'
  | 'doormat'
  | 'aframe'
  | 'roundTable'
  | 'chair'
  | 'plant'
  | 'bigPlant'
  | 'fan'
  | 'rug'
  | 'sofa'
  | 'sideLamp'
  | 'armchair'
  | 'pendant'
  | 'hangingPlant'
  | 'desk'
  | 'coffeeStation'
  | 'floorLamp'
  | 'stairwell';

export interface Prop {
  kind: PropKind;
  /** Footprint origin and size in tiles. */
  x: number;
  y: number;
  w: number;
  d: number;
  /** Blocks walking. */
  solid: boolean;
  /** Orientation hint (chairs: the way the sitter faces; shelves: the way they open). */
  face?: Dir;
  /** Draw-time options (lamp on a desk, height of a shelf…). */
  opts?: { lamp?: boolean; h?: number; plantOnTop?: boolean };
}

export type DecorKind =
  | 'window'
  | 'door'
  | 'menu'
  | 'mugShelf'
  | 'sconce'
  | 'clock'
  | 'framed'
  | 'kanban'
  | 'curtains'
  | 'bunting'
  | 'wallPlant';

/** Something mounted on a wall: `a` runs along the wall in tiles, `v` is height in px. */
export interface Decor {
  kind: DecorKind;
  wall: 'L' | 'R';
  a0: number;
  a1: number;
  v0: number;
  v1: number;
  color?: string;
}

export interface FloorLayout {
  id: ProviderId;
  title: string;
  /** Surface height of this floor in px. */
  z: number;
  w: number;
  d: number;
  floor: 'checker' | 'planks';
  props: Prop[];
  decor: Decor[];
  stations: Record<StationId, Spot[]>;
  /** Home seats, assigned in agent order. */
  seats: Spot[];
  /** Where newly hired agents appear. */
  entrance: Spot;
}

const P = (kind: PropKind, x: number, y: number, w: number, d: number, solid: boolean, extra: Partial<Prop> = {}): Prop => ({
  kind, x, y, w, d, solid, ...extra,
});
const S = (x: number, y: number, face: Dir): Spot => ({ x, y, face });
const chair = (x: number, y: number, face: Dir) => P('chair', x - 0.22, y - 0.22, 0.44, 0.44, false, { face });
const table = (x: number, y: number) => P('roundTable', x - 0.5, y - 0.5, 1, 1, true);

const { H1, UW, UD } = BUILDING;

/** Ground floor (OpenAI): the café. A cosy nook under the upper floor, the counter in the open. */
export const GROUND: FloorLayout = {
  id: 'openai',
  title: 'GROUND FLOOR · OPENAI',
  z: 0,
  w: BUILDING.W,
  d: BUILDING.D,
  floor: 'checker',
  props: [
    // Café counter in the open-air part.
    P('backbar', 9.4, 0, 4.6, 0.6, true),
    P('cafeCounter', 9.6, 2.2, 4.2, 0.8, true),
    // Left wall, front part.
    P('bookshelf', 0, 6.2, 0.45, 1.3, true, { face: 'x+', opts: { h: 44, plantOnTop: true } }),
    P('windowBar', 0, 7.8, 0.55, 1.4, true),
    P('stool', 0.85, 7.85, 0.3, 0.3, false),
    P('stool', 0.85, 8.85, 0.3, 0.3, false),
    P('coatRack', 0.3, 9.3, 0.3, 0.3, true),
    P('umbrellas', 0.36, 10.46, 0.28, 0.28, true),
    P('doormat', 0.05, 9.75, 0.9, 1.0, false),
    P('aframe', 2.9, 10.0, 0.1, 0.7, true),
    // Seating out front.
    table(4.1, 9.0), chair(3.2, 9.0, 'x+'), chair(5.0, 9.0, 'x-'),
    table(8.0, 7.6), chair(7.1, 7.6, 'x+'), chair(8.9, 7.6, 'x-'),
    table(11.6, 8.2), chair(10.7, 8.2, 'x+'), chair(12.5, 8.2, 'x-'),
    P('bigPlant', 13.2, 10.2, 0.4, 0.4, true),
    P('bigPlant', 13.3, 6.1, 0.4, 0.4, true),
    P('fan', 13.15, 9.15, 0.3, 0.3, true),
    // The nook under the upper floor: low things only.
    P('rug', 1.0, 1.2, 5.6, 3.8, false),
    P('sofa', 0, 1.4, 0.6, 3.6, false), // seats are on it; against the wall it never blocks a route
    P('sideLamp', 0.15, 5.25, 0.4, 0.4, true),
    table(1.6, 2.4),
    table(1.6, 4.2),
    P('armchair', 3.9, 2.8, 0.8, 0.8, true),
    P('cabinet', 7.8, 4.9, 0.8, 0.7, true),
    P('pendant', 2.4, 3.2, 0, 0, false),
    P('pendant', 5.4, 3.2, 0, 0, false),
    P('hangingPlant', 1.2, UD - 0.1, 0, 0, false),
    P('hangingPlant', 4.0, UD - 0.1, 0, 0, false),
    P('hangingPlant', 6.8, UD - 0.1, 0, 0, false),
  ],
  decor: [
    { kind: 'menu', wall: 'R', a0: 9.6, a1: 12.2, v0: 26, v1: 50 },
    { kind: 'mugShelf', wall: 'R', a0: 12.4, a1: 13.9, v0: 40, v1: 40 },
    { kind: 'mugShelf', wall: 'R', a0: 12.4, a1: 13.9, v0: 30, v1: 30 },
    { kind: 'sconce', wall: 'R', a0: 13.2, a1: 13.2, v0: 52, v1: 52 },
    { kind: 'window', wall: 'R', a0: 1.2, a1: 4.6, v0: 24, v1: 50 },
    { kind: 'window', wall: 'L', a0: 7.7, a1: 9.3, v0: 18, v1: 46 },
    { kind: 'door', wall: 'L', a0: 9.7, a1: 10.8, v0: 0, v1: 38 },
    { kind: 'framed', wall: 'L', a0: 7.9, a1: 8.5, v0: 50, v1: 58, color: '#4f9aa5' },
    { kind: 'framed', wall: 'L', a0: 8.7, a1: 9.2, v0: 51, v1: 57, color: '#f2c14e' },
    { kind: 'sconce', wall: 'L', a0: 9.5, a1: 9.5, v0: 44, v1: 44 },
    { kind: 'clock', wall: 'L', a0: 6.9, a1: 6.9, v0: 54, v1: 54 },
    { kind: 'framed', wall: 'L', a0: 2.0, a1: 2.8, v0: 20, v1: 32, color: '#e76f51' },
    { kind: 'framed', wall: 'L', a0: 3.1, a1: 3.7, v0: 22, v1: 30, color: '#4f9aa5' },
  ],
  stations: {
    register: [S(13.0, 3.6, 'y-'), S(12.4, 3.6, 'y-')],
    pickup: [S(10.2, 3.6, 'y-'), S(10.8, 3.6, 'y-')],
    clock: [S(1.1, 6.35, 'x-'), S(1.6, 6.6, 'x-')],
    bookcase: [S(1.0, 6.9, 'x-'), S(1.1, 7.4, 'x-')],
    archive: [S(8.2, 6.2, 'y-'), S(7.6, 6.2, 'y-')],
  },
  seats: [
    S(3.2, 9.0, 'x+'), S(7.1, 7.6, 'x+'), S(10.7, 8.2, 'x+'),
    S(5.0, 9.0, 'x-'), S(8.9, 7.6, 'x-'), S(12.5, 8.2, 'x-'),
    S(0.35, 2.1, 'x+'), S(0.35, 4.3, 'x+'),
  ],
  entrance: S(1.2, 10.2, 'x+'),
};

/** Upper floor (Anthropic): the loft office. Stairwell opening at the back-left. */
export const UPSTAIRS: FloorLayout = {
  id: 'anthropic',
  title: 'UPSTAIRS · ANTHROPIC',
  z: H1,
  w: UW,
  d: UD,
  floor: 'planks',
  props: [
    P('rug', 2.0, 1.9, 6.4, 3.0, false),
    P('stairwell', 0.25, 0.25, 1.6, 1.6, true),
    P('desk', 1.3, 3.2, 1.8, 0.7, true, { opts: { lamp: true } }),
    P('desk', 4.0, 3.2, 1.8, 0.7, true),
    P('desk', 6.7, 3.2, 1.8, 0.7, true, { opts: { lamp: true } }),
    chair(2.2, 2.4, 'y+'), chair(4.9, 2.4, 'y+'), chair(7.6, 2.4, 'y+'),
    P('bookshelf', 2.2, 0, 2.2, 0.45, true, { face: 'y+', opts: { h: 44 } }),
    P('archive', 0, 4.4, 0.45, 1.5, true, { face: 'x+', opts: { h: 32 } }),
    table(5.0, 5.2), chair(4.2, 5.2, 'x+'), chair(5.8, 5.2, 'x-'),
    P('coffeeStation', 8.2, 4.95, 0.65, 0.5, true),
    P('bigPlant', 8.35, 4.15, 0.4, 0.4, true),
    P('floorLamp', 3.0, 5.3, 0.2, 0.2, true),
  ],
  decor: [
    { kind: 'kanban', wall: 'L', a0: 2.2, a1: 4.2, v0: H1 + 10, v1: H1 + 38 },
    { kind: 'clock', wall: 'L', a0: 5.1, a1: 5.1, v0: H1 + 39, v1: H1 + 39 },
    { kind: 'bunting', wall: 'L', a0: 0.3, a1: 5.8, v0: H1 + 45, v1: H1 + 45 },
    { kind: 'window', wall: 'R', a0: 4.8, a1: 8.6, v0: H1 + 10, v1: H1 + 40 },
    { kind: 'curtains', wall: 'R', a0: 4.8, a1: 8.6, v0: H1 + 8, v1: H1 + 42 },
    { kind: 'wallPlant', wall: 'R', a0: 1.0, a1: 1.0, v0: H1 + 44, v1: H1 + 44 },
  ],
  stations: {
    register: [S(0.65, 3.2, 'x-'), S(0.65, 3.7, 'x-')],
    archive: [S(0.85, 5.15, 'x-'), S(0.9, 4.6, 'x-')],
    clock: [S(0.9, 4.6, 'x-'), S(0.85, 5.15, 'x-')],
    bookcase: [S(3.3, 0.9, 'y-'), S(2.7, 0.9, 'y-')],
    pickup: [S(2.3, 1.05, 'x-')],
  },
  seats: [S(2.2, 2.4, 'y+'), S(4.9, 2.4, 'y+'), S(7.6, 2.4, 'y+'), S(4.2, 5.2, 'x+'), S(5.8, 5.2, 'x-')],
  entrance: S(2.3, 1.05, 'y+'),
};

export const FLOORS: Record<ProviderId, FloorLayout> = { openai: GROUND, anthropic: UPSTAIRS };
/** Bottom to top. */
export const FLOOR_ORDER: ProviderId[] = ['openai', 'anthropic'];

/** Is a point under the upper floor (only visible through the gap between floors)? */
export const underUpperFloor = (p: Pt) => p.x < UW && p.y < UD;

// ── Pathing grid ─────────────────────────────────────────────────────────────

/** Pathing cells are half a tile: fine enough to walk between chairs. */
export const CELL = 0.5;

export function gridSize(floor: FloorLayout) {
  return { cols: Math.round(floor.w / CELL), rows: Math.round(floor.d / CELL) };
}

/** Cell (i, j) is blocked if it overlaps any solid footprint (shrunk slightly so neighbours stay walkable). */
export function isBlockedCell(floor: FloorLayout, i: number, j: number): boolean {
  const { cols, rows } = gridSize(floor);
  if (i < 0 || j < 0 || i >= cols || j >= rows) return true;
  const x0 = i * CELL + 0.06, y0 = j * CELL + 0.06, x1 = (i + 1) * CELL - 0.06, y1 = (j + 1) * CELL - 0.06;
  return floor.props.some((p) => p.solid && p.x < x1 && p.x + p.w > x0 && p.y < y1 && p.y + p.d > y0);
}

export const cellOf = (p: Pt) => ({ i: Math.floor(p.x / CELL), j: Math.floor(p.y / CELL) });
export const cellCenter = (i: number, j: number): Pt => ({ x: (i + 0.5) * CELL, y: (j + 0.5) * CELL });
