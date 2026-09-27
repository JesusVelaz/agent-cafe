import { cellCenter, cellOf, gridSize, isBlockedCell, type FloorLayout, type Pt } from './layout';

const NEIGHBOURS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * 4-neighbour A* over a floor's half-tile grid. Returns waypoints after `from`
 * (cell centres, then the exact target), [] when already there, or null when
 * unreachable. The start and goal cells may themselves be blocked: agents sit
 * on sofas and step off furniture. Deterministic (fixed neighbour order, stable
 * tie-break) so agents walk the same routes.
 */
export function findPath(floor: FloorLayout, from: Pt, to: Pt): Pt[] | null {
  if (Math.hypot(from.x - to.x, from.y - to.y) < 0.01) return [];
  const { cols } = gridSize(floor);
  const s = cellOf(from);
  const g0 = cellOf(to);
  if (s.i === g0.i && s.j === g0.j) return [{ x: to.x, y: to.y }];

  const key = (i: number, j: number) => j * cols + i;
  const h = (i: number, j: number) => Math.abs(i - g0.i) + Math.abs(j - g0.j);
  const gScore = new Map<number, number>([[key(s.i, s.j), 0]]);
  const came = new Map<number, number>();
  const open: Array<{ i: number; j: number; f: number; n: number }> = [{ i: s.i, j: s.j, f: h(s.i, s.j), n: 0 }];
  const closed = new Set<number>();
  let counter = 0;

  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) {
      const a = open[k]!;
      const b = open[bi]!;
      if (a.f < b.f || (a.f === b.f && a.n < b.n)) bi = k;
    }
    const cur = open.splice(bi, 1)[0]!;
    const ck = key(cur.i, cur.j);
    if (cur.i === g0.i && cur.j === g0.j) return reconstruct(came, ck, cols, to);
    if (closed.has(ck)) continue;
    closed.add(ck);

    for (const [di, dj] of NEIGHBOURS) {
      const ni = cur.i + di;
      const nj = cur.j + dj;
      const isGoal = ni === g0.i && nj === g0.j;
      if (!isGoal && isBlockedCell(floor, ni, nj)) continue;
      if (isGoal && (ni < 0 || nj < 0)) continue;
      const nk = key(ni, nj);
      const ng = gScore.get(ck)! + 1;
      if (ng < (gScore.get(nk) ?? Infinity)) {
        gScore.set(nk, ng);
        came.set(nk, ck);
        open.push({ i: ni, j: nj, f: ng + h(ni, nj), n: ++counter });
      }
    }
  }
  return null;
}

function reconstruct(came: Map<number, number>, end: number, cols: number, target: Pt): Pt[] {
  const cells: Pt[] = [];
  let k: number | undefined = came.get(end); // the goal cell itself is replaced by the exact target
  while (k !== undefined && came.has(k)) {
    cells.push(cellCenter(k % cols, Math.floor(k / cols)));
    k = came.get(k);
  }
  cells.reverse();
  cells.push({ x: target.x, y: target.y });
  return cells;
}
