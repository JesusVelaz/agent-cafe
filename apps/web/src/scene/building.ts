/**
 * Composes one frame of the café: shell, furniture, agents, lighting, labels.
 *
 * Draw order: backdrop → slab and ground floor → walls and decor → three
 * depth-sorted layers → lighting → overlays.
 * The layers are (1) the nook under the upper floor, (2) the upper floor, and
 * (3) the open café in front. Everything in a later layer is in front of the
 * earlier ones wherever they overlap on screen, so sorting by x+y within each
 * layer is enough.
 */
import type { ProviderId, ProviderMode } from '@agent-cafe/shared';
import { BUILDING, FLOORS, GROUND, OUTDOOR, UPSTAIRS, underUpperFloor, type Dir, type Prop } from '@/sim/layout';
import type { CatView } from '@/sim/cats';
import type { Bubble, Pose } from '@/sim/world';
import { backdrop, frontWeather, grade, type ThemeId } from './atmosphere';
import { cloudShadows, drawSky, streetLife } from './ambient';
import { barista } from './barista';
import { text, textW } from './font';
import { iso } from './iso';
import { plotOffset, SCENE_H, SCENE_W } from './frame';
import { drawStreet } from './outdoor';
import { K } from './palette';
import {
  chairBackFront, drawDecor, drawProp, floorTiles, railing, roofPlanter,
  stringLights, wallCap, wallRun, type DrawCtx,
} from './props';
import type { Raster } from './raster';
import { outfitFor } from './avatar';
import { agentGrid, agentLook, CAT, CAT_FURS, ICON_PAL, ICONS, type AgentFrame, type CatFrame, type IconName } from './sprites';

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
  /** The café cats (ambience only; not hit-tested). */
  cats?: CatView[];
}

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
}

const TOOL_ICON: Record<string, IconName> = {
  calculator: 'calc', current_time: 'clock', notes_read: 'note', notes_write: 'note', read_file: 'book', list_files: 'book',
  Read: 'book', Glob: 'book', Grep: 'book', LS: 'book', WebFetch: 'book', WebSearch: 'book',
  Edit: 'pen', MultiEdit: 'pen', Write: 'pen', NotebookEdit: 'pen', TodoWrite: 'note',
  Bash: 'term', PowerShell: 'term',
};

export function renderScene(R: Raster, agents: SceneAgent[], o: SceneOptions): AgentHit[] {
  const off = plotOffset(R);
  const P = iso(ORIGIN.x + off.x, ORIGIN.y + off.y);
  const c: DrawCtx = { R, P, t: o.t, theme: o.theme, lights: [] };
  const { W, D, H1, UW, UD, H2 } = BUILDING;
  const TOP = H1 + H2;

  backdrop(R, o.theme, o.t, Boolean(o.transparent));
  drawSky(c);
  drawStreet(c);
  floorTiles(c, W, D, 0, GROUND.floor);

  // Walls: full-height where the upper floor sits, one story where it steps back.
  wallRun(c, 'L', 0, D, 0, H1, false);
  wallRun(c, 'R', 0, W, 0, H1, false);
  wallRun(c, 'L', 0, UD, H1, TOP, true);
  wallRun(c, 'R', 0, UW, H1, TOP, true);
  wallCap(c, 'R', UW, W, H1, -10);
  wallCap(c, 'L', UD, D, H1, -10);
  wallCap(c, 'R', 0, UW, TOP, H1);
  wallCap(c, 'L', 0, UD, TOP, H1);
  for (const d of GROUND.decor) drawDecor(c, d);
  for (const d of UPSTAIRS.decor) drawDecor(c, d);

  const under: Item[] = [];
  const up: Item[] = [];
  const front: Item[] = [];

  const addProp = (p: Prop, z: number, ceiling: number, list: Item[]) => {
    const cx = p.x + p.w / 2, cy = p.y + p.d / 2;
    const flat = p.kind === 'rug' || p.kind === 'doormat' || p.kind === 'stairwell';
    const hanging = p.kind === 'pendant' || p.kind === 'hangingPlant';
    list.push({ d: flat ? -100 : hanging ? 1000 : cx + cy, f: () => drawProp(c, p, z, ceiling) });
    if (p.kind === 'chair' && (p.face === 'x-' || p.face === 'y-')) list.push({ d: cx + cy + 0.8, f: () => chairBackFront(c, cx, cy, z, p.face!) });
  };
  for (const p of GROUND.props) addProp(p, 0, H1, underUpperFloor({ x: p.x + p.w / 2, y: p.y + p.d / 2 }) ? under : front);
  for (const p of OUTDOOR) addProp(p, 0, H1, front);

  // The upper floor: slab, boards, furniture, railings.
  up.push({
    d: -1000,
    f: () => {
      // Slab edge (the ceiling of the nook below).
      R.poly([P(0, UD, H1 - 6), P(UW, UD, H1 - 6), P(UW, UD, H1), P(0, UD, H1)], K.woodD);
      R.poly([P(UW, 0, H1 - 6), P(UW, UD, H1 - 6), P(UW, UD, H1), P(UW, 0, H1)], '#4a2c1a');
      floorTiles(c, UW, UD, H1, UPSTAIRS.floor);
    },
  });
  for (const p of UPSTAIRS.props) addProp(p, H1, TOP, up);
  const stair = UPSTAIRS.props.find((p) => p.kind === 'stairwell');
  up.push({ d: 500, f: () => { railing(c, 0.05, UD - 0.05, UW - 0.05, UD - 0.05, H1); railing(c, UW - 0.05, 0.05, UW - 0.05, UD - 0.05, H1); } });
  if (stair) up.push({ d: stair.x + stair.y + stair.d + 0.2, f: () => railing(c, stair.x, stair.y + stair.d + 0.05, stair.x + stair.w, stair.y + stair.d + 0.05, H1) });

  // Agents join the layer they stand in.
  const hits: AgentHit[] = [];
  const heads: Array<{ a: SceneAgent; hit: AgentHit }> = [];
  for (const a of agents) {
    const z = FLOORS[a.providerId].z;
    const list = z > 0 ? up : underUpperFloor(a) ? under : front;
    list.push({
      d: a.x + a.y + 0.5,
      f: () => {
        const hit = drawAgent(c, a, z, a.id === o.selectedId);
        hits.push(hit);
        heads.push({ a, hit });
      },
    });
  }

  for (const cat of o.cats ?? []) {
    const z = FLOORS[cat.floor].z;
    const list = z > 0 ? up : underUpperFloor(cat) ? under : front;
    list.push({ d: cat.x + cat.y + 0.3, f: () => drawCat(c, cat, z) });
  }

  streetLife(c, (d, f) => front.push({ d, f }));
  barista(c, (d, f) => front.push({ d, f }));

  for (const L of [under, up, front]) {
    L.sort((p, q) => p.d - q.d);
    for (const it of L) it.f();
  }
  roofPlanter(c, UW + 0.5, 3.6, H1);
  stringLights(c, [[UW, 0, H1 - 1], [11.5, 0, H1 - 1], [W, 0, H1 - 1]], 0);
  stringLights(c, [[0, UD, H1 - 1], [0, 8.5, H1 - 1], [0, D, H1 - 1]], 2);
  stringLights(c, [[0, 0, TOP - 2], [4.5, 0, TOP - 2], [UW, 0, TOP - 2]], 3);

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
  return hits;
}

function frameFor(a: SceneAgent): { frame: AgentFrame; bob: number } {
  const back = a.face === 'x-' || a.face === 'y-';
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
  const g = agentGrid(frame, look);
  const top = feet[1] - g.length + 1 + (seated ? -2 : 0) + bob;
  R.grid(g, look.palette, feet[0] - 7, top, a.face === 'y+' || a.face === 'x-');
  const headY = top + (seated ? 3 : 0);
  return { id: a.id, x0: feet[0] - 7, y0: headY - 2, x1: feet[0] + 7, y1: feet[1] + 2, headX: feet[0], headY };
}

function drawCat(c: DrawCtx, cat: CatView, z: number) {
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
  R.grid(g, pal, feet[0] - Math.floor(w / 2), feet[1] - g.length + 1 + bob, cat.face === 'x-' || cat.face === 'y+');
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
