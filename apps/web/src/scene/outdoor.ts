/**
 * The street around the café: plot, sidewalk, patio, road, and outdoor props.
 * Theme-aware: lamps glow at night and in bad weather, puddles in the rain,
 * snow settles on trees, parasols and the car.
 */
import { BUILDING, type Prop } from '@/sim/layout';
import { isDim, THEMES } from './atmosphere';
import { box, disc, plane, quad } from './iso';
import { hash, K, shade } from './palette';
import type { Pt2 } from './raster';
import type { DrawCtx } from './props';
import { PLANT_PAL, PLANT_SMALL } from './sprites';

const SIDEWALK = ['#bdb7ad', '#c7c1b6'];
const SEAM = '#a29c92';
const ASPHALT = '#4a4f57';

/** A filled circle in screen space (for canopies and parasols). */
function blob(c: DrawCtx, x: number, y: number, r: number, col: string, a = 1) {
  const pts: Pt2[] = [];
  for (let i = 0; i < 14; i++) {
    const t = (i / 14) * Math.PI * 2;
    pts.push([x + Math.cos(t) * r, y + Math.sin(t) * r * 0.85]);
  }
  c.R.poly(pts, col, a);
}

const snowy = (c: DrawCtx) => c.theme === 'snow';

// ── ground ──────────────────────────────────────────────────────────────────

/** Plot slab, sidewalk, road and patio. Drawn before the building. */
export function drawStreet(c: DrawCtx) {
  const { R, P, theme, t } = c;
  const { W, D, PW, PD, ROAD_Y } = BUILDING;
  const TH = THEMES[theme];

  // Contact shadow and the plot's slab.
  R.poly([P(-0.6, -0.6, -18), P(PW + 1.4, -0.6, -18), P(PW + 1.4, PD + 1.4, -18), P(-0.6, PD + 1.4, -18)], TH.floorShadow, 0.55, true);
  box(R, P, -0.28, -0.28, -12, PW + 0.28, PD + 0.28, 10, K.slab, { top: '#8a847a', line: '#2e1d14' });

  // Sidewalk tiles (outside the building and the patio).
  const snow = snowy(c);
  for (let x = 0; x < PW; x++) {
    for (let y = 0; y < Math.ceil(ROAD_Y); y++) {
      if (x < W && y < D) continue;
      const yd = Math.min(1, ROAD_Y - y);
      quad(R, P, x, y, 1, yd, 0, snow ? '#e6e9ec' : SEAM);
      const col = snow ? (hash(x * 31 + y) > 0.5 ? '#f4f6f8' : '#eceff2') : SIDEWALK[(x + y) % 2]!;
      quad(R, P, x + 0.05, y + 0.05, 0.9, Math.max(0.05, yd - 0.1), 0, col);
    }
  }

  // Road with curb, lane dashes and a crossing.
  quad(R, P, 0, ROAD_Y, PW, PD - ROAD_Y, -2, snow ? '#6a7079' : ASPHALT);
  plane(R, P, { y: ROAD_Y }, 0, PW, -2, 0, '#8f8a82');
  quad(R, P, 0, ROAD_Y - 0.14, PW, 0.14, 0, snow ? '#ffffff' : '#d6d1c7');
  const mid = ROAD_Y + (PD - ROAD_Y) / 2 - 0.06;
  for (let x = 0.4; x < PW; x += 1.6) if (x < 11.6 || x > 15.2) quad(R, P, x, mid, 0.8, 0.12, -2, '#e8e2c8');
  for (let x = 12.2; x < 15.0; x += 0.55) quad(R, P, x, ROAD_Y + 0.25, 0.28, PD - ROAD_Y - 0.5, -2, snow ? '#ffffff' : '#dcd6c4');
  if (snow) quad(R, P, 0, ROAD_Y, PW, 0.35, -2, '#f4f6f8', 0.8);

  // Wooden patio beside the café.
  box(R, P, 14.5, 0.25, 0, 5.2, 9.5, 1, K.woodD, { top: K.plank });
  for (let x = 14.5; x < 19.7; x += 0.5) quad(R, P, x, 0.25, 0.46, 9.5, 1, hash(Math.round(x * 10)) > 0.5 ? K.plank : K.plankL);
  if (snow) quad(R, P, 14.5, 0.25, 5.2, 9.5, 1.1, '#ffffff', 0.7);

  // Threshold where the café floor meets the sidewalk.
  quad(R, P, 0, D - 0.12, W, 0.12, 0.1, K.woodD);
  quad(R, P, W - 0.12, 0, 0.12, D, 0.1, K.woodD);

  // Rain: puddles that ripple.
  if (theme === 'rain') {
    for (const [px, py, r] of [[6.5, 15.6, 0.9], [16.8, 13.2, 0.6], [3.2, 12.4, 0.5], [17.6, 15.9, 0.8]] as const) {
      const ground = py > ROAD_Y ? -2 : 0;
      disc(R, P, px, py, r, ground + 0.1, '#8ea3b5', 0.55);
      const k = (t * 1.5 + px) % 1;
      disc(R, P, px, py, r * (0.3 + k * 0.6), ground + 0.1, '#c7d6e2', 0.35 * (1 - k));
    }
  }
}

// ── props ───────────────────────────────────────────────────────────────────

function lamppost(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x - 0.12, y - 0.12, 0, 0.24, 0.24, 3, '#3a4048', { line: true });
  box(R, P, x - 0.04, y - 0.04, 3, 0.08, 0.08, 44, '#3a4048');
  box(R, P, x - 0.14, y - 0.14, 46, 0.28, 0.28, 2, '#2f343b');
  const q = P(x, y, 50);
  R.rect(q[0] - 3, q[1] - 4, 7, 7, '#2f343b');
  R.rect(q[0] - 2, q[1] - 3, 5, 5, isDim(c.theme) ? '#ffe6a8' : '#f3ead0', 1, isDim(c.theme));
  R.rect(q[0] - 4, q[1] - 6, 9, 2, snowy(c) ? '#ffffff' : '#2f343b');
  if (isDim(c.theme)) {
    const g = P(x, y, 0);
    c.lights.push({ x: q[0], y: q[1] + 6, r: 30, col: [1, 0.86, 0.6], s: 1.2 });
    c.lights.push({ x: g[0], y: g[1] - 4, r: 46, col: [1, 0.86, 0.6], s: 0.9 });
  }
}

function tree(c: DrawCtx, x: number, y: number) {
  const { R, P, theme } = c;
  quad(R, P, x - 0.4, y - 0.4, 0.8, 0.8, 0.1, '#5a4636');
  box(R, P, x - 0.08, y - 0.08, 0, 0.16, 0.16, 20, '#6b4a33', { line: true });
  const q = P(x, y, 34);
  const base = theme === 'summer' ? '#5f9a44' : theme === 'snow' ? '#4f7058' : K.leaf;
  const dark = shade(base, -0.28);
  const light = shade(base, 0.22);
  const parts: Array<[number, number, number]> = [[-9, 4, 9], [9, 4, 9], [0, 6, 10], [-5, -5, 9], [6, -4, 9], [0, -10, 8]];
  // The upper canopy leans with the breeze, a pixel either way.
  const sway = Math.round(Math.sin(c.t * 1.1 + x * 1.7) * 1.2);
  const lean = (dy: number) => (dy < 0 ? sway : 0);
  for (const [dx, dy, r] of parts) blob(c, q[0] + dx + lean(dy), q[1] + dy + 2, r, dark);
  for (const [dx, dy, r] of parts) blob(c, q[0] + dx - 1 + lean(dy), q[1] + dy, r - 2, base);
  blob(c, q[0] - 4 + sway, q[1] - 9, 4, light);
  blob(c, q[0] + 5 + sway, q[1] - 4, 3, light);
  if (snowy(c)) for (const [dx, dy, r] of parts.slice(3)) blob(c, q[0] + dx - 1 + sway, q[1] + dy - r + 3, r - 3, '#ffffff');
  if (!snowy(c)) fallingLeaves(c, x, y, q[0], q[1], dark, base);
  if (theme === 'summer') for (let i = 0; i < 5; i++) R.px(q[0] - 8 + hash(i * 7) * 16, q[1] - 8 + hash(i * 3) * 14, '#f5a3c0');
}

/** Now and then a leaf lets go and drifts to the ground. */
function fallingLeaves(c: DrawCtx, x: number, y: number, qx: number, qy: number, dark: string, base: string) {
  const ground = c.P(x, y, 0)[1] + 3;
  for (let i = 0; i < 3; i++) {
    const per = 6.5 + i * 2.1, tt = c.t + x * 3 + i * 2.9, k = Math.floor(tt / per), ph = tt - k * per;
    if (ph > 5.5) continue;
    const lx = qx - 9 + hash(k * 13 + i * 7) * 18 + Math.sin(ph * 2.4) * 3 + ph * 2;
    const ly = Math.min(qy + ph * 7, ground);
    const a = ly >= ground ? Math.max(0, 1 - (ph - (ground - qy) / 7) / 1.2) : 1;
    if (a > 0) c.R.rect(lx, ly, 2, 1, i % 2 ? dark : (c.theme === 'summer' ? base : K.amber), a);
  }
}

function bench(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  for (const lx of [0.1, p.w - 0.2]) box(R, P, p.x + lx, p.y + 0.1, 0, 0.1, p.d - 0.2, 7, '#3a4048');
  box(R, P, p.x, p.y, 7, p.w, p.d, 2, K.woodL, { line: true });
  box(R, P, p.x, p.y, 9, p.w, 0.1, 7, K.wood, { line: true });
  if (snowy(c)) quad(R, P, p.x, p.y + 0.1, p.w, p.d - 0.1, 9.1, '#ffffff');
}

function parasolTable(c: DrawCtx, x: number, y: number) {
  const { R, P, theme } = c;
  const z = 1;
  // Back chair, table, then the chair on the viewer's side (painter's order).
  bistroChair(c, x - 0.85, y, z, 'x+');
  box(R, P, x - 0.05, y - 0.05, z, 0.1, 0.1, 10, K.ink);
  disc(R, P, x, y, 0.45, z + 10, '#3f4a4f');
  disc(R, P, x, y, 0.45, z + 11, '#e9dcc3');
  box(R, P, x - 0.15, y + 0.05, z + 11, 0.13, 0.13, 3, K.white, { line: K.metalD });
  bistroChair(c, x + 0.85, y, z, 'x-');
  box(R, P, x - 0.03, y - 0.03, z + 11, 0.06, 0.06, 25, '#e9dcc3');
  const flutter = Math.round(Math.sin(c.t * 1.6 + y * 2) * 0.8);
  const top0 = P(x, y, z + 38);
  const top: Pt2 = [top0[0] + flutter, top0[1]];
  // Striped canopy.
  const pts = (r: number): Pt2[] => Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return [top[0] + Math.cos(a) * r * 1.6, top[1] + 6 + Math.sin(a) * r * 0.8] as Pt2;
  });
  R.poly(pts(12), theme === 'snow' ? '#ffffff' : K.berry);
  const ring = pts(12);
  for (let i = 0; i < 8; i += 2) R.poly([[top[0], top[1]], ring[i]!, ring[(i + 1) % 8]!], theme === 'snow' ? '#e6ecf1' : K.cream);
  R.rect(top[0] - 1, top[1] - 2, 3, 3, K.ink);
}

/** Café bistro chair: dark metal frame, rattan seat, slatted back behind the sitter. */
function bistroChair(c: DrawCtx, x: number, y: number, z: number, face: 'x+' | 'x-') {
  const { R, P } = c;
  const frame = '#2f3a3f';
  for (const [lx, ly] of [[-0.16, -0.16], [0.12, -0.16], [-0.16, 0.12], [0.12, 0.12]] as const) box(R, P, x + lx, y + ly, z, 0.04, 0.04, 7, frame);
  box(R, P, x - 0.2, y - 0.2, z + 7, 0.4, 0.4, 2, '#c9a06a', { line: frame });
  const bx = face === 'x+' ? x - 0.22 : x + 0.17;
  for (const ly of [-0.18, 0.14]) box(R, P, bx, y + ly, z + 9, 0.05, 0.04, 10, frame);
  box(R, P, bx, y - 0.2, z + 18, 0.05, 0.4, 2, frame);
  box(R, P, bx, y - 0.14, z + 12, 0.05, 0.28, 1, '#c9a06a');
  box(R, P, bx, y - 0.14, z + 15, 0.05, 0.28, 1, '#c9a06a');
}

function planterBox(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  box(R, P, p.x, p.y, 0, p.w, p.d, 7, K.woodL, { line: true, top: '#5a4636' });
  const along = p.w > p.d;
  const n = Math.max(1, Math.floor((along ? p.w : p.d) / 0.45));
  for (let i = 0; i < n; i++) {
    const q = along ? P(p.x + 0.25 + i * 0.45, p.y + p.d / 2, 7) : P(p.x + p.w / 2, p.y + 0.25 + i * 0.45, 7);
    R.grid(PLANT_SMALL, { l: i % 2 ? K.leafL : K.leaf, L: K.leafD }, q[0] - 2, q[1] - 3);
  }
  if (snowy(c)) quad(R, P, p.x, p.y, p.w, p.d, 7.1, '#ffffff', 0.9);
}

function bikeRack(c: DrawCtx, p: Prop) {
  const { R, P } = c;
  for (let i = 0; i < 3; i++) {
    const a = P(p.x + 0.2 + i * 0.6, p.y + 0.2, 0), b = P(p.x + 0.2 + i * 0.6, p.y + 0.2, 12);
    const d2 = P(p.x + 0.5 + i * 0.6, p.y + 0.2, 12), e = P(p.x + 0.5 + i * 0.6, p.y + 0.2, 0);
    R.line(a[0], a[1], b[0], b[1], '#6c7680'); R.line(b[0], b[1], d2[0], d2[1], '#6c7680'); R.line(d2[0], d2[1], e[0], e[1], '#6c7680');
  }
  // A bike leaning in the rack.
  const w1 = P(p.x + 0.3, p.y + 0.55, 5), w2 = P(p.x + 1.3, p.y + 0.55, 5);
  for (const w of [w1, w2]) { blob(c, w[0], w[1], 5, K.ink); blob(c, w[0], w[1], 3.6, shade(SEAM, 0.1)); }
  const s = P(p.x + 0.7, p.y + 0.55, 12), h = P(p.x + 1.15, p.y + 0.55, 14);
  R.line(w1[0], w1[1], s[0], s[1], K.teal); R.line(s[0], s[1], w2[0], w2[1], K.teal); R.line(s[0], s[1], h[0], h[1], K.teal);
  R.line(w2[0], w2[1], h[0], h[1], K.teal);
}

function hydrant(c: DrawCtx, x: number, y: number) {
  const { R, P } = c;
  box(R, P, x - 0.12, y - 0.12, 0, 0.24, 0.24, 9, '#c9463d', { line: true });
  box(R, P, x - 0.16, y - 0.05, 5, 0.32, 0.1, 2, '#a83a33');
  box(R, P, x - 0.08, y - 0.08, 9, 0.16, 0.16, 2, snowy(c) ? '#ffffff' : '#a83a33');
}

export function drawOutdoor(c: DrawCtx, p: Prop): void {
  const cx = p.x + p.w / 2, cy = p.y + p.d / 2;
  switch (p.kind) {
    case 'lamppost': return lamppost(c, cx, cy);
    case 'tree': return tree(c, cx, cy);
    case 'bench': return bench(c, p);
    case 'parasolTable': return parasolTable(c, cx, cy);
    case 'planterBox': return planterBox(c, p);
    case 'bikeRack': return bikeRack(c, p);
    case 'hydrant': return hydrant(c, cx, cy);
    default:
      return;
  }
}
