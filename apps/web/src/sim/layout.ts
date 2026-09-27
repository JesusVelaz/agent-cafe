/**
 * Café floor plans in tile coordinates. Each floor is a W×D grid; x runs toward
 * the screen's lower-right, y toward the lower-left. Back walls sit along x=0
 * (left wall) and y=0 (right wall); the two front edges are open (diorama cutaway).
 *
 * The layout is pure data: the simulation paths over it and the renderer draws it.
 * Adding a provider = adding a floor here (and to FLOOR_ORDER).
 */
import type { ProviderId } from '@agent-cafe/shared';

export const FLOOR_W = 14;
export const FLOOR_D = 10;

export type Dir = 'x+' | 'x-' | 'y+' | 'y-';
export interface Tile {
  x: number;
  y: number;
}
export interface Spot extends Tile {
  /** Direction the agent faces while here. */
  face: Dir;
}

/** Stations agents walk to. Tools map onto these (see activity.ts). */
export type StationId = 'register' | 'clock' | 'bookcase' | 'archive' | 'pickup';

export type PropKind =
  | 'counter'
  | 'backbar'
  | 'espresso'
  | 'register'
  | 'pickup'
  | 'table'
  | 'chair'
  | 'desk'
  | 'bookcase'
  | 'cabinet'
  | 'archive'
  | 'ledger'
  | 'plant'
  | 'rack'
  | 'outbox'
  | 'stairs'
  | 'rug';

export interface Prop extends Tile {
  kind: PropKind;
  /** Blocks walking. Chairs and rugs don't. */
  solid: boolean;
  /** Optional variant/orientation hint for the renderer. */
  variant?: string;
}

export type WallDecorKind = 'window' | 'door' | 'menu' | 'clock' | 'ticketRail' | 'poster' | 'corkboard' | 'sign';

export interface WallDecor {
  kind: WallDecorKind;
  /** 'left' = wall along x=0 (spans y), 'right' = wall along y=0 (spans x). */
  wall: 'left' | 'right';
  /** Start tile along the wall and length in tiles. */
  at: number;
  span: number;
  label?: string;
}

export interface FloorLayout {
  id: ProviderId;
  title: string;
  props: Prop[];
  decor: WallDecor[];
  stations: Record<StationId, Spot[]>;
  /** Where agents sit when idle or thinking; assigned in agent order. */
  homeSeats: Spot[];
  /** Tile where cups for finished tasks appear, in display order. */
  cupSlots: Tile[];
  /** Where queued-task tickets hang. */
  ticketWall: WallDecor;
  floorColors: [string, string];
}

const p = (kind: PropKind, x: number, y: number, solid = true, variant?: string): Prop => ({
  kind,
  x,
  y,
  solid,
  ...(variant ? { variant } : {}),
});
const s = (x: number, y: number, face: Dir): Spot => ({ x, y, face });

const groundTicketRail: WallDecor = { kind: 'ticketRail', wall: 'right', at: 4, span: 5 };

/** Ground floor (OpenAI): the café proper. Counter, tables, pickup window. */
export const GROUND: FloorLayout = {
  id: 'openai',
  title: 'GROUND FLOOR · OPENAI',
  floorColors: ['#e8dfc8', '#2f3b52'],
  props: [
    // Back bar behind the counter (barista side).
    ...[4, 5, 6, 7, 8, 9, 10].map((x) => p('backbar', x, 0)),
    ...[4, 5, 6, 7, 8, 9, 10].map((x) => p('backbar', x, 1, true, 'floor')),
    // Counter run: espresso, plain, register, then the pickup end.
    p('espresso', 4, 2),
    p('counter', 5, 2),
    p('counter', 6, 2),
    p('counter', 7, 2),
    p('register', 8, 2),
    p('pickup', 9, 2),
    p('pickup', 10, 2),
    // Seating: three round tables, two chairs each (home seats).
    p('table', 4, 5),
    p('chair', 3, 5, false, 'x+'),
    p('chair', 5, 5, false, 'x-'),
    p('table', 8, 5),
    p('chair', 7, 5, false, 'x+'),
    p('chair', 9, 5, false, 'x-'),
    p('table', 6, 8),
    p('chair', 5, 8, false, 'x+'),
    p('chair', 7, 8, false, 'x-'),
    // Left wall furniture.
    p('bookcase', 0, 5),
    p('bookcase', 0, 6),
    p('cabinet', 0, 8),
    p('plant', 0, 0),
    p('plant', 13, 0),
    p('plant', 0, 9),
    // Stairs up, front-right corner.
    p('stairs', 12, 8),
    p('stairs', 13, 8),
    p('stairs', 12, 9),
    p('stairs', 13, 9),
    p('rug', 1, 1, false),
  ],
  decor: [
    { kind: 'door', wall: 'left', at: 1, span: 1 },
    { kind: 'window', wall: 'left', at: 3, span: 2, label: 'COFFEE' },
    { kind: 'clock', wall: 'left', at: 5, span: 1 },
    groundTicketRail,
    { kind: 'menu', wall: 'right', at: 11, span: 3, label: 'MENU' },
    { kind: 'poster', wall: 'right', at: 1, span: 1 },
    { kind: 'poster', wall: 'left', at: 8, span: 1 },
  ],
  stations: {
    register: [s(8, 3, 'y-')],
    pickup: [s(9, 3, 'y-'), s(10, 3, 'y-')],
    clock: [s(1, 5, 'x-'), s(2, 4, 'x-')],
    bookcase: [s(1, 6, 'x-'), s(1, 5, 'x-')],
    archive: [s(1, 8, 'x-'), s(1, 7, 'x-')],
  },
  homeSeats: [s(3, 5, 'x+'), s(7, 5, 'x+'), s(5, 8, 'x+'), s(5, 5, 'x-'), s(9, 5, 'x-'), s(7, 8, 'x-')],
  cupSlots: [
    { x: 9, y: 2 },
    { x: 10, y: 2 },
  ],
  ticketWall: groundTicketRail,
};

const upstairsCork: WallDecor = { kind: 'corkboard', wall: 'left', at: 7, span: 2 };

/** Upstairs (Anthropic): the quieter loft office. Desks, archive, ledger. */
export const UPSTAIRS: FloorLayout = {
  id: 'anthropic',
  title: 'UPSTAIRS · ANTHROPIC',
  floorColors: ['#e8dfc8', '#4a3a57'],
  props: [
    p('rack', 0, 0),
    p('rack', 1, 0),
    // Archive shelves and bookcase on the right wall.
    p('archive', 3, 0),
    p('archive', 4, 0),
    p('archive', 5, 0),
    p('bookcase', 8, 0),
    p('bookcase', 9, 0),
    p('plant', 11, 0),
    // Ledger desk (calculator) on the left wall.
    p('ledger', 0, 5),
    // Two rows of desks; agents sit behind them, facing the viewer.
    p('desk', 3, 4),
    p('desk', 6, 4),
    p('desk', 9, 4),
    p('desk', 3, 7),
    p('desk', 6, 7),
    p('desk', 9, 7),
    p('chair', 3, 3, false, 'y+'),
    p('chair', 6, 3, false, 'y+'),
    p('chair', 9, 3, false, 'y+'),
    p('chair', 3, 6, false, 'y+'),
    p('chair', 6, 6, false, 'y+'),
    p('chair', 9, 6, false, 'y+'),
    // Outbox hatch by the stairs: finished work goes down to the counter.
    p('outbox', 13, 5),
    p('outbox', 13, 6),
    p('stairs', 12, 8),
    p('stairs', 13, 8),
    p('stairs', 12, 9),
    p('stairs', 13, 9),
    p('plant', 0, 9),
    p('rug', 6, 1, false),
  ],
  decor: [
    { kind: 'window', wall: 'left', at: 2, span: 2 },
    { kind: 'clock', wall: 'left', at: 4, span: 1 },
    upstairsCork,
    { kind: 'poster', wall: 'right', at: 6, span: 1 },
    { kind: 'sign', wall: 'right', at: 11, span: 2, label: 'LOFT' },
  ],
  stations: {
    register: [s(1, 5, 'x-'), s(1, 6, 'x-')],
    clock: [s(1, 4, 'x-'), s(2, 4, 'x-')],
    bookcase: [s(8, 1, 'y-'), s(9, 1, 'y-')],
    archive: [s(4, 1, 'y-'), s(3, 1, 'y-'), s(5, 1, 'y-')],
    pickup: [s(12, 5, 'x+'), s(12, 6, 'x+')],
  },
  homeSeats: [s(3, 3, 'y+'), s(6, 3, 'y+'), s(9, 3, 'y+'), s(3, 6, 'y+'), s(6, 6, 'y+'), s(9, 6, 'y+')],
  cupSlots: [
    { x: 13, y: 5 },
    { x: 13, y: 6 },
  ],
  ticketWall: upstairsCork,
};

export const FLOORS: Record<ProviderId, FloorLayout> = { openai: GROUND, anthropic: UPSTAIRS };
/** Bottom to top. */
export const FLOOR_ORDER: ProviderId[] = ['openai', 'anthropic'];

export function isBlocked(floor: FloorLayout, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= FLOOR_W || y >= FLOOR_D) return true;
  return floor.props.some((pr) => pr.solid && pr.x === x && pr.y === y);
}
