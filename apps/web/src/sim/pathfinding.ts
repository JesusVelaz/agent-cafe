import { FLOOR_D, FLOOR_W, isBlocked, type FloorLayout, type Tile } from './layout';

const key = (x: number, y: number) => y * FLOOR_W + x;
const NEIGHBOURS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 4-neighbour A* over a floor's tile grid. Returns the tiles after `from` up to and
 * including `to`, [] when already there, or null when unreachable. Deterministic
 * (fixed neighbour order, stable tie-break) so agents walk the same routes.
 */
export function findPath(floor: FloorLayout, from: Tile, to: Tile): Tile[] | null {
  const sx = Math.round(from.x);
  const sy = Math.round(from.y);
  if (sx === to.x && sy === to.y) return [];
  if (isBlocked(floor, to.x, to.y)) return null;

  const h = (x: number, y: number) => Math.abs(x - to.x) + Math.abs(y - to.y);
  const g = new Map<number, number>([[key(sx, sy), 0]]);
  const came = new Map<number, number>();
  const open: Array<{ x: number; y: number; f: number; n: number }> = [{ x: sx, y: sy, f: h(sx, sy), n: 0 }];
  const closed = new Set<number>();
  let counter = 0;

  while (open.length) {
    // Small grids (140 tiles): a linear scan beats a heap in clarity and speed.
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i]!;
      const b = open[bi]!;
      if (a.f < b.f || (a.f === b.f && a.n < b.n)) bi = i;
    }
    const cur = open.splice(bi, 1)[0]!;
    const ck = key(cur.x, cur.y);
    if (cur.x === to.x && cur.y === to.y) return reconstruct(came, ck);
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= FLOOR_W || ny >= FLOOR_D) continue;
      // The start tile may be "blocked" (e.g. spawned on a prop); every other step may not.
      if (isBlocked(floor, nx, ny)) continue;
      const nk = key(nx, ny);
      const ng = g.get(ck)! + 1;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng);
        came.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + h(nx, ny), n: ++counter });
      }
    }
  }
  return null;
}

function reconstruct(came: Map<number, number>, end: number): Tile[] {
  const path: Tile[] = [];
  let k: number | undefined = end;
  while (k !== undefined && came.has(k)) {
    path.push({ x: k % FLOOR_W, y: Math.floor(k / FLOOR_W) });
    k = came.get(k);
  }
  return path.reverse();
}
