/**
 * Composes one frame of the café: shell, furniture, agents, lighting, labels.
 *
 * The café can be seen from four sides (and anywhere between, mid-turn): the
 * camera angle turns the world before projection (see iso.ts), and the two sides
 * of the building facing away from the camera are the ones drawn.
 *
 * Draw order: backdrop → street → outdoor things beyond the far walls → ground
 * floor → far walls and decor → depth-sorted passes → lighting → overlays.
 * The passes are (1) the nook under the upper floor, (2) ground-floor things
 * behind the upper floor, (3) the upper floor, (4) everything else. Everything in
 * a later pass is in front of the earlier ones wherever they overlap on screen,
 * so sorting by camera depth within each is enough. From today's angle pass 2 is
 * empty and this is the order the café has always been drawn in.
 *
 * When the upper floor is on the camera's side it fades (so the café below shows
 * through), with the agents and cats up there drawn solid on top.
 */
import type { ProviderId, ProviderMode } from '@agent-cafe/shared';
import { BUILDING, FLOORS, GROUND, OUTDOOR, UPSTAIRS, underUpperFloor, type DecorSide, type Dir, type Prop } from '@/sim/layout';
import type { CatView } from '@/sim/cats';
import type { Bubble, Pose } from '@/sim/world';
import { backdrop, frontWeather, grade, type ThemeId } from './atmosphere';
import { cloudShadows, drawSky, streetLife } from './ambient';
import { barista } from './barista';
import { text, textW } from './font';
import { box, depth, facing, faceVisible, iso, setCameraAngle, viewFace } from './iso';
import { plotOffset, SCENE_H, SCENE_W } from './frame';
import { drawStreet } from './outdoor';
import { K } from './palette';
import {
  chairBackFront, drawDecor, drawProp, floorTiles, railing, roofPlanter,
  SIDES, stringLights, wallCap, wallRun, type DrawCtx,
} from './props';
import { Raster } from './raster';
import { outfitFor } from './avatar';
import { agentLook, agentSprite, CAT, CAT_FURS, ICON_PAL, ICONS, type AgentFrame, type CatFrame, type IconName, type Mood } from './sprites';

export { SCENE_H, SCENE_W };
/** Screen position of the plot's back corner in a base-size frame: centres the street plot. */
const ORIGIN = { x: 222, y: 145 };

export interface SceneAgent {
  id: string;
  name: string;
  providerId: ProviderId;
  x: number;
  y: number;
  face: Dir;
  pose: Pose;
  /** Seconds in the current pose (frame animation). */
  t: number;
  bubble: Bubble | null;
  spriteSeed: number;
  demo: boolean;
}

export interface SceneOptions {
  theme: ThemeId;
  /** Seconds, for ambient animation. */
  t: number;
  transparent?: boolean;
  labels?: boolean;
  selectedId?: string | null;
  floors?: Partial<Record<ProviderId, { mode: ProviderMode; closed: boolean }>>;
  /** The café cats. */
  cats?: CatView[];
  /** When each cat was last petted (cat id → `t`): hearts float up for a moment. */
  petted?: ReadonlyMap<string, number>;
  /** Camera angle in radians; 0 (the default) is today's view from the street corner. */
  angle?: number;
}

/** Where the clickable things were drawn this frame. */
export interface SceneHits {
  agents: AgentHit[];
  cats: AgentHit[];
}

/** An agent's (or cat's) sprite on screen. */
export interface AgentHit {
  id: string;
  /** Sprite bounds in scene px, for pointer hit-testing. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Top of the head, where tooltips and callouts point. */
  headX: number;
  headY: number;
}

interface Item {
  d: number;
  f: () => void;
  /** World position, for deciding which pass it belongs to. */
  x?: number;
  y?: number;
  /** An agent or cat: drawn solid on top of a faded upper floor. */
  actor?: boolean;
}

/** How long hearts float over a petted cat (s). */
const HEARTS_FOR = 1.6;

// ── see-through layers ──────────────────────────────────────────────────────

/** Scratch frames for things drawn see-through (walls mid-turn, the faded loft), reused frame to frame. */
const layers = new Map<string, Raster>();

/** Run `draw` into a scratch frame and lay it over c.R at `alpha` (straight onto c.R when solid). */
function inLayer(c: DrawCtx, key: string, alpha: number, draw: () => void) {
  if (alpha <= 0.002) return;
  if (alpha >= 0.998) { draw(); return; }
  const R = c.R;
  let L = layers.get(key);
  if (!L || L.w !== R.w || L.h !== R.h) { L = new Raster(R.w, R.h); layers.set(key, L); } else L.clear();
  c.R = L;
  try { draw(); } finally { c.R = R; }
  const s = L.d, d = R.d;
  for (let i = 0, o = 0; i < L.em.length; i++, o += 4) {
    const la = s[o + 3]!;
    if (!la) continue;
    const k = (la / 255) * alpha;
    if (d[o + 3] === 0) { d[o] = s[o]!; d[o + 1] = s[o + 1]!; d[o + 2] = s[o + 2]!; d[o + 3] = Math.round(k * 255); }
    else { d[o] = d[o]! + (s[o]! - d[o]!) * k; d[o + 1] = d[o + 1]! + (s[o + 1]! - d[o + 1]!) * k; d[o + 2] = d[o + 2]! + (s[o + 2]! - d[o + 2]!) * k; }
    if (L.em[i] && k > 0.5) R.em[i] = 1;
  }
}

/** How much of a wall shows: fully on the far side of the building, fading out as it turns side-on. */
export const wallAlpha = (s: DecorSide) => Math.max(0, Math.min(1, -facing(...SIDES[s].n) * 2 - 0.4));

/** The upper floor's opacity: solid from today's side, 50 % when it's the corner nearest the camera. */
export function loftAlpha(): number {
  // The loft sits in the building's back corner, so it comes toward the camera as that corner does.
  const toward = (facing(-Math.SQRT1_2, -Math.SQRT1_2) + 1) / 2;
  return 1 - 0.5 * Math.pow(toward, 1.5);
}

const TOOL_ICON: Record<string, IconName> = {
  calculator: 'calc', current_time: 'clock', notes_read: 'note', notes_write: 'note', read_file: 'book', list_files: 'book',
  Read: 'book', Glob: 'book', Grep: 'book', LS: 'book', WebFetch: 'book', WebSearch: 'book',
  Edit: 'pen', MultiEdit: 'pen', Write: 'pen', NotebookEdit: 'pen', TodoWrite: 'note',
  Bash: 'term', PowerShell: 'term',
};

export function renderScene(R: Raster, agents: SceneAgent[], o: SceneOptions): SceneHits {
  setCameraAngle(o.angle ?? 0);
  const off = plotOffset(R);
  const P = iso(ORIGIN.x + off.x, ORIGIN.y + off.y);
  const c: DrawCtx = { R, P, t: o.t, theme: o.theme, lights: [] };
  const { W, D, H1, UW, UD, H2 } = BUILDING;
  const TOP = H1 + H2;

  backdrop(R, o.theme, o.t, Boolean(o.transparent));
  drawSky(c);
  drawStreet(c);

  // The building's far sides are shown; mid-turn they fade in and out.
  const alpha: Record<DecorSide, number> = { L: wallAlpha('L'), R: wallAlpha('R'), F: wallAlpha('F'), E: wallAlpha('E') };
  // Outdoor things beyond the shown walls are drawn before them: outside one wall
  // and alongside it, or out in the corner past both.
  const shown = (['L', 'R', 'F', 'E'] as const).filter((s) => alpha[s] > 0.5);
  const beyond = (x: number, y: number) => {
    const outside = shown.filter((s) => {
      const { o, n } = SIDES[s];
      return (x - o[0]) * n[0] + (y - o[1]) * n[1] > 0;
    });
    const alongside = (s: DecorSide) => {
      const { o, u } = SIDES[s];
      const a = (x - o[0]) * u[0] + (y - o[1]) * u[1];
      return a > -0.5 && a < (u[0] ? W : D) + 0.5;
    };
    return outside.length >= 2 || outside.some(alongside);
  };

  const under: Item[] = [];
  const up: Item[] = [];
  const front: Item[] = [];
  const outside: Item[] = [];

  const addProp = (p: Prop, z: number, ceiling: number, list: Item[]) => {
    const cx = p.x + p.w / 2, cy = p.y + p.d / 2;
    const flat = p.kind === 'rug' || p.kind === 'doormat' || p.kind === 'stairwell';
    const hanging = p.kind === 'pendant' || p.kind === 'hangingPlant';
    list.push({ d: flat ? -100 : hanging ? 1000 : depth(cx, cy), x: cx, y: cy, f: () => drawProp(c, p, z, ceiling) });
    if (p.kind === 'chair') list.push({ d: depth(cx, cy) + 0.8, x: cx, y: cy, f: () => chairBackFront(c, cx, cy, z, p.face!) });
  };
  for (const p of GROUND.props) addProp(p, 0, H1, underUpperFloor({ x: p.x + p.w / 2, y: p.y + p.d / 2 }) ? under : front);
  for (const p of OUTDOOR) addProp(p, 0, H1, outside);

  // The upper floor: slab, boards, furniture, railings.
  up.push({
    d: -1000,
    f: () => {
      // Slab edge (the ceiling of the nook below): whichever two sides face us.
      box(c.R, P, 0, 0, H1 - 6, UW, UD, 6, K.woodD, { right: '#4a2c1a' });
      floorTiles(c, UW, UD, H1, UPSTAIRS.floor);
    },
  });
  for (const p of UPSTAIRS.props) addProp(p, H1, TOP, up);
  const stair = UPSTAIRS.props.find((p) => p.kind === 'stairwell');
  up.push({ d: faceVisible(0, 1) ? 500 : -500, f: () => railing(c, 0.05, UD - 0.05, UW - 0.05, UD - 0.05, H1) });
  up.push({ d: faceVisible(1, 0) ? 500 : -500, f: () => railing(c, UW - 0.05, 0.05, UW - 0.05, UD - 0.05, H1) });
  if (stair) up.push({ d: depth(stair.x + stair.w / 2, stair.y + stair.d) + 0.2, f: () => railing(c, stair.x, stair.y + stair.d + 0.05, stair.x + stair.w, stair.y + stair.d + 0.05, H1) });

  // Agents join the layer they stand in.
  const hits: AgentHit[] = [];
  const heads: Array<{ a: SceneAgent; hit: AgentHit }> = [];
  for (const a of agents) {
    const z = FLOORS[a.providerId].z;
    const list = z > 0 ? up : underUpperFloor(a) ? under : front;
    list.push({
      d: depth(a.x, a.y) + 0.5, x: a.x, y: a.y, actor: true,
      f: () => {
        const hit = drawAgent(c, a, z, a.id === o.selectedId);
        hits.push(hit);
        heads.push({ a, hit });
      },
    });
  }

  const catHits: AgentHit[] = [];
  for (const cat of o.cats ?? []) {
    const z = FLOORS[cat.floor].z;
    const list = z > 0 ? up : underUpperFloor(cat) ? under : front;
    list.push({ d: depth(cat.x, cat.y) + 0.3, x: cat.x, y: cat.y, actor: true, f: () => catHits.push(drawCat(c, cat, z)) });
  }

  const push = (list: Item[]) => (x: number, y: number, bias: number, f: () => void) => list.push({ d: depth(x, y) + bias, x, y, f });
  streetLife(c, push(outside));
  barista(c, push(front));

  const sortDraw = (L: Item[]) => { L.sort((p, q) => p.d - q.d); for (const it of L) it.f(); };

  // Outdoor things on the far side of the building, then the floor and the far walls.
  sortDraw(outside.filter((it) => beyond(it.x!, it.y!)));
  floorTiles(c, W, D, 0, GROUND.floor);
  const sideDraw: Record<DecorSide, () => void> = {
    // Walls: full-height where the upper floor sits, one story where it steps back.
    L: () => { wallRun(c, 'L', 0, D, 0, H1, false); wallRun(c, 'L', 0, UD, H1, TOP, true); wallCap(c, 'L', UD, D, H1, -10); wallCap(c, 'L', 0, UD, TOP, H1); },
    R: () => { wallRun(c, 'R', 0, W, 0, H1, false); wallRun(c, 'R', 0, UW, H1, TOP, true); wallCap(c, 'R', UW, W, H1, -10); wallCap(c, 'R', 0, UW, TOP, H1); },
    F: () => { wallRun(c, 'F', 0, W, 0, H1, false); wallCap(c, 'F', 0, W, H1, H1); },
    E: () => { wallRun(c, 'E', 0, D, 0, H1, false); wallCap(c, 'E', 0, D, H1, H1); },
  };
  for (const s of ['L', 'R', 'F', 'E'] as const) {
    inLayer(c, 'wall' + s, alpha[s], () => {
      sideDraw[s]();
      for (const d of GROUND.decor) if (d.wall === s) drawDecor(c, d);
      for (const d of UPSTAIRS.decor) if (d.wall === s) drawDecor(c, d);
    });
  }

  // The passes: the nook, ground-floor things behind the loft, the loft, then the rest.
  const corners = [[0, 0], [UW, 0], [UW, UD], [0, UD]] as const;
  const loftFar = Math.min(...corners.map(([x, y]) => depth(x, y)));
  const rest = [...front, ...outside.filter((it) => !beyond(it.x!, it.y!))];
  sortDraw(under);
  sortDraw(rest.filter((it) => it.d < loftFar));
  const la = loftAlpha();
  if (la >= 0.998) sortDraw(up);
  else {
    inLayer(c, 'loft', la, () => sortDraw(up.filter((it) => !it.actor)));
    sortDraw(up.filter((it) => it.actor));
  }
  sortDraw(rest.filter((it) => it.d >= loftFar));

  if (alpha.R > 0.5) {
    roofPlanter(c, UW + 0.5, 3.6, H1);
    stringLights(c, [[UW, 0, H1 - 1], [11.5, 0, H1 - 1], [W, 0, H1 - 1]], 0);
  }
  if (alpha.L > 0.5) stringLights(c, [[0, UD, H1 - 1], [0, 8.5, H1 - 1], [0, D, H1 - 1]], 2);
  if (alpha.R > 0.5) stringLights(c, [[0, 0, TOP - 2], [4.5, 0, TOP - 2], [UW, 0, TOP - 2]], 3);

  cloudShadows(c);
  if (o.theme === 'summer') c.lights.push({ x: off.x + SCENE_W * 0.62, y: off.y + SCENE_H * 0.45, r: 120, col: [1, 0.9, 0.6], s: 1.4 });
  grade(R, o.theme, c.lights);
  frontWeather(R, o.theme, o.t);

  // Overlays stay unlit so they read in every theme.
  for (const { a, hit } of heads) {
    if (o.labels !== false) {
      const s = a.name.toUpperCase().slice(0, 12);
      text(R, s, hit.headX - Math.floor(textW(s) / 2), hit.headY - 8, a.id === o.selectedId ? K.amber : '#ffffff', { outline: K.ink });
    }
    if (a.bubble) drawBubble(R, hit, a, o.t);
  }
  for (const h of catHits) {
    const at = o.petted?.get(h.id);
    if (at !== undefined) drawHearts(R, h, o.t - at);
  }
  for (const id of ['openai', 'anthropic'] as const) {
    const f = o.floors?.[id];
    const sign = f?.mode === 'off' ? 'SWITCHED OFF' : f?.closed && f.mode === 'live' ? 'USAGE LIMIT REACHED' : null;
    if (!sign) continue;
    const q = id === 'openai' ? P(W / 2 + 2.5, D / 2 + 2.5, 30) : P(UW / 2, UD / 2, H1 + 30);
    const w = textW(sign) + 8;
    R.rect(q[0] - w / 2 - 1, q[1] - 1, w + 2, 11, K.ink);
    R.rect(q[0] - w / 2, q[1], w, 9, K.coral);
    text(R, sign, q[0] - w / 2 + 4, q[1] + 2, '#ffffff');
  }
  return { agents: hits, cats: catHits };
}

const HEART = [[-1, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-1, 2], [0, 2], [1, 2], [0, 3]] as const;

/** Three little hearts drifting up off a cat, `since` seconds after it was petted. */
function drawHearts(R: Raster, h: AgentHit, since: number) {
  if (since < 0 || since > HEARTS_FOR) return;
  const a = Math.min(1, (HEARTS_FOR - since) * 2);
  for (let i = 0; i < 3; i++) {
    const k = since - i * 0.18;
    if (k < 0) continue;
    const hx = h.headX + (i - 1) * 5 + Math.round(Math.sin(k * 6 + i) * 1.5), hy = h.headY - 4 - Math.round(k * 14);
    for (const [dx, dy] of HEART) R.px(hx + dx, hy + dy, K.coral, a);
    R.px(hx - 1, hy, '#ffb3a3', a);
  }
}

function frameFor(a: SceneAgent): { frame: AgentFrame; bob: number } {
  const vf = viewFace(a.face);
  const back = vf === 'x-' || vf === 'y-';
  switch (a.pose) {
    case 'walk': {
      const k = Math.floor(a.t * 8) % 4;
      const seq: AgentFrame[] = back ? ['backWalkA', 'backStand', 'backWalkB', 'backStand'] : ['walkA', 'stand', 'walkB', 'stand'];
      return { frame: seq[k]!, bob: k % 2 ? -1 : 0 };
    }
    case 'type':
      return { frame: Math.floor(a.t * 6) % 2 ? 'typeA' : 'typeB', bob: 0 };
    case 'sit':
      return { frame: 'sit', bob: (a.t % 3) < 0.35 ? -1 : 0 };
    case 'slump':
    case 'sleep':
      return { frame: 'sleep', bob: 1 };
    case 'work':
      return { frame: back ? 'backStand' : 'stand', bob: Math.floor(a.t * 3) % 2 ? -1 : 0 };
    default:
      return { frame: back ? 'backStand' : 'stand', bob: 0 };
  }
}

/** The face backs up the bubble, so you can read the room from a distance. */
const MOOD: Partial<Record<Bubble['kind'], Mood>> = { think: 'think', tool: 'focus', ask: 'ask', done: 'done', fail: 'fail' };

function drawAgent(c: DrawCtx, a: SceneAgent, z: number, selected: boolean): AgentHit {
  const { R, P } = c;
  const feet = P(a.x, a.y, z);
  const { frame, bob } = frameFor(a);
  const seated = frame === 'sit' || frame === 'typeA' || frame === 'typeB' || frame === 'sleep';
  const look = agentLook(a.spriteSeed, outfitFor(a.providerId));
  if (selected) {
    // Brass diamond on the floor under the selected agent.
    R.poly([[feet[0], feet[1] - 4], [feet[0] + 9, feet[1]], [feet[0], feet[1] + 4], [feet[0] - 9, feet[1]]], K.brass, 0.45);
  }
  R.rect(feet[0] - 4, feet[1], 9, 1, '#000000', 0.22);
  R.rect(feet[0] - 3, feet[1] - 1, 7, 3, '#000000', 0.12);
  const { grid: g, palette } = agentSprite(frame, look, a.bubble ? MOOD[a.bubble.kind] : undefined);
  const top = feet[1] - g.length + 1 + (seated ? -2 : 0) + bob;
  const vf = viewFace(a.face);
  R.grid(g, palette, feet[0] - 7, top, vf === 'y+' || vf === 'x-');
  const headY = top + (seated ? 3 : 0);
  return { id: a.id, x0: feet[0] - 7, y0: headY - 2, x1: feet[0] + 7, y1: feet[1] + 2, headX: feet[0], headY };
}

function drawCat(c: DrawCtx, cat: CatView, z: number): AgentHit {
  const { R, P } = c;
  const feet = P(cat.x, cat.y, z + cat.z);
  const step = Math.floor(cat.t * 6) % 2;
  const frame: CatFrame = cat.pose === 'walk' ? (step ? 'walkB' : 'walkA') : cat.pose;
  const bob = cat.pose === 'walk' && !step ? -1 : 0;
  const g = CAT[frame];
  // Slow blinks while awake and still.
  const blink = cat.pose !== 'walk' && cat.pose !== 'sleep' && cat.t % 4 > 3.75;
  const fur = CAT_FURS[cat.fur % CAT_FURS.length]!;
  const pal = blink ? { ...fur, y: fur.k! } : fur;
  const w = g[0]!.length;
  R.rect(feet[0] - Math.floor(w / 2), feet[1], w, 1, '#000000', 0.18);
  const vf = viewFace(cat.face);
  const top = feet[1] - g.length + 1 + bob;
  R.grid(g, pal, feet[0] - Math.floor(w / 2), top, vf === 'x-' || vf === 'y+');
  // A little slack around a small sprite, so a cat is easy to click.
  return { id: cat.id, x0: feet[0] - Math.floor(w / 2) - 1, y0: top - 2, x1: feet[0] + Math.ceil(w / 2) + 1, y1: feet[1] + 1, headX: feet[0], headY: top };
}

function drawBubble(R: Raster, hit: AgentHit, a: SceneAgent, t: number) {
  const b = a.bubble!;
  const bx = hit.headX + Math.ceil(textW(a.name.slice(0, 12)) / 2) + 2;
  const by = hit.headY - 16;
  if (b.kind === 'zzz') {
    text(R, 'Z', bx + 1, hit.headY - 8 - (Math.floor(t * 2) % 3) * 3, '#ffffff', { outline: K.ink });
    return;
  }
  R.rect(bx + 1, by, 11, 1, K.ink);
  R.rect(bx, by + 1, 13, 7, K.ink);
  R.rect(bx + 1, by + 8, 11, 1, K.ink);
  R.rect(bx + 1, by + 1, 11, 7, '#ffffff');
  R.rect(bx + 1, by + 9, 2, 1, K.ink);
  R.rect(bx, by + 10, 1, 1, K.ink);
  if (b.kind === 'think') {
    const n = Math.max(1, Math.floor(t * 3) % 4);
    for (let i = 0; i < n; i++) R.rect(bx + 3 + i * 3, by + 4, 2, 2, K.ink);
    return;
  }
  const icon: IconName =
    b.kind === 'tool' ? TOOL_ICON[b.tool] ?? 'hourglass'
    : b.kind === 'wait' ? 'hourglass'
    : b.kind === 'done' ? 'check'
    : b.kind === 'ask' ? 'ask'
    : 'alert';
  R.grid(ICONS[icon], ICON_PAL, bx + 3, by + 2);
}
