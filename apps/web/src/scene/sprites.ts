/**
 * Hand-authored pixel sprites as palette-indexed string grids ('.' = transparent).
 * Swapping in a real sprite sheet later only means replacing what these return.
 */
import { HAIR, K, PANTS, SHIRT, SKIN, shade } from './palette';

export type Grid = readonly string[];

// ── Agents (12×20) ── o outline · h/H hair · s/S skin · e eyes · c/C shirt · p pants · b shoes
const HEAD_F: Grid = ['...oooooo...', '..ohhhhhho..', '..ohhhhhho..', '..ohssssho..', '..osesseso..', '..osssssso..', '...oSSSSo...'];
const HEAD_B: Grid = ['...oooooo...', '..ohhhhhho..', '..ohhhhhho..', '..ohhhhhho..', '..ohhhhhho..', '..oHhhhhHo..', '...oSSSSo...'];
const HEAD_Z: Grid = ['...oooooo...', '..ohhhhhho..', '..ohhhhhho..', '..ohssssho..', '..osSssSso..', '..osssssso..', '...oSSSSo...'];
const TORSO: Grid = ['..occsscco..', '.occcccccco.', 'oCccccccccCo', 'oCccccccccCo', 'oCccccccccCo', 'osCccccccCso', '.oCccccccCo.'];
const TORSO_T: Grid = [...TORSO.slice(0, 5), 'oCsccccccsCo', TORSO[6]!];
const LEGS: Grid = ['.oppppppppo.', '.opppoopppo.', '.opppoopppo.', '.opppoopppo.', '.obbboobbbo.', '.oooooooooo.'];
const LEGS_A: Grid = ['.oppppppppo.', '.opppoopppo.', '.opppoopppo.', '.opppoobbbo.', '.obbbooooo..', '.ooooo......'];
const LEGS_B: Grid = ['.oppppppppo.', '.opppoopppo.', '.opppoopppo.', '.obbboopppo.', '..ooooobbbo.', '......ooooo.'];
const LEGS_SIT: Grid = ['.opppoopppo.', '.obbboobbbo.', '.oooooooooo.'];
const BLANK3: Grid = ['............', '............', '............'];

export type AgentFrame = 'stand' | 'walkA' | 'walkB' | 'sit' | 'typeA' | 'typeB' | 'sleep' | 'backStand' | 'backWalkA' | 'backWalkB';

export const AGENT: Record<AgentFrame, Grid> = {
  stand: [...HEAD_F, ...TORSO, ...LEGS],
  walkA: [...HEAD_F, ...TORSO, ...LEGS_A],
  walkB: [...HEAD_F, ...TORSO, ...LEGS_B],
  sit: [...BLANK3, ...HEAD_F, ...TORSO, ...LEGS_SIT],
  typeA: [...BLANK3, ...HEAD_F, ...TORSO, ...LEGS_SIT],
  typeB: [...BLANK3, ...HEAD_F, ...TORSO_T, ...LEGS_SIT],
  sleep: [...BLANK3, ...HEAD_Z, ...TORSO, ...LEGS_SIT],
  backStand: [...HEAD_B, ...TORSO, ...LEGS],
  backWalkA: [...HEAD_B, ...TORSO, ...LEGS_A],
  backWalkB: [...HEAD_B, ...TORSO, ...LEGS_B],
};
export const AGENT_W = 12;
export const AGENT_H = 20;
export const isSeatedFrame = (f: AgentFrame) => f === 'sit' || f === 'typeA' || f === 'typeB' || f === 'sleep';
export const isBackFrame = (f: AgentFrame) => f.startsWith('back');

export type Accessory = 'none' | 'glasses' | 'phones' | 'beanie';

/** Glasses, headphones or a beanie: small touches that make agents easy to tell apart. */
export function accessorize(g: Grid, acc: Accessory, frame: AgentFrame): Grid {
  if (acc === 'none') return g;
  const off = isSeatedFrame(frame) ? 3 : 0;
  const back = isBackFrame(frame);
  const rows = g.slice();
  const set = (r: number, c: number, ch: string) => {
    const row = rows[r + off]!;
    rows[r + off] = row.slice(0, c) + ch + row.slice(c + 1);
  };
  if (acc === 'glasses' && !back) { set(4, 3, 'G'); set(4, 5, 'G'); set(4, 6, 'G'); set(4, 8, 'G'); }
  if (acc === 'phones') {
    for (let c = 3; c <= 8; c++) set(0, c, 'Q');
    set(1, 2, 'Q'); set(1, 9, 'Q');
    for (const r of [2, 3, 4]) { set(r, 1, 'Q'); set(r, 10, 'Q'); }
  }
  if (acc === 'beanie') { rows[off] = '...oBBBBo...'; rows[off + 1] = '..oBBBBBBo..'; rows[off + 2] = '..oWWWWWWo..'; }
  return rows;
}

/** The cream DEMO apron worn by agents on a mock-mode floor (front views only). */
export function withApron(g: Grid, frame: AgentFrame): Grid {
  if (isBackFrame(frame)) return g;
  const off = isSeatedFrame(frame) ? 3 : 0;
  return g.map((row, r) => {
    const tr = r - off - HEAD_F.length;
    const chars = row.split('');
    if (tr === 1 || tr === 2) { chars[4] = 'a'; chars[7] = 'a'; }
    if (tr >= 3 && tr <= 6) for (let c = 4; c <= 7; c++) chars[c] = tr === 6 ? 'A' : 'a';
    return chars.join('');
  });
}

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AgentLook {
  palette: Record<string, string>;
  accessory: Accessory;
}

/** Deterministic look from an agent's spriteSeed: an agent always looks the same. */
export function agentLook(seed: number): AgentLook {
  const rnd = seeded(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const hair = pick(HAIR), skin = pick(SKIN), shirt = pick(SHIRT), pants = pick(PANTS);
  const accessory = pick(['none', 'glasses', 'phones', 'beanie'] as const);
  return {
    accessory,
    palette: {
      o: K.ink, e: K.ink, b: '#3a2a22', G: '#2b1d17', Q: '#3a3f47', B: '#5d7fb8', W: '#dfe7ee', a: K.cream, A: K.creamShade,
      h: hair, H: shade(hair, -0.25), s: skin, S: shade(skin, -0.18), c: shirt, C: shade(shirt, -0.22), p: pants,
    },
  };
}

// ── Bubble icons (7×5) ── k ink · w white · g green · r red · y amber · b blue
export const ICONS = {
  book: ['.kk.kk.', 'kbbkyyk', 'kbbkyyk', 'kbbkyyk', '.kkkkk.'],
  calc: ['.kkkkk.', '.kbbbk.', '.kkkkk.', '.kwkwk.', '.kkkkk.'],
  clock: ['.kkkkk.', 'kwwkwwk', 'kwwkkwk', 'kwwwwwk', '.kkkkk.'],
  note: ['.yyyyy.', '.ykkky.', '.yyyyy.', '.ykkyy.', '.yyyyy.'],
  check: ['......g', '.....g.', 'g...g..', '.g.g...', '..g....'],
  alert: ['...r...', '...r...', '...r...', '.......', '...r...'],
  hourglass: ['kkkkkkk', '.kyyyk.', '..kyk..', '.k.y.k.', 'kkkkkkk'],
} as const satisfies Record<string, Grid>;
export type IconName = keyof typeof ICONS;
export const ICON_PAL = { k: K.ink, w: '#ffffff', b: '#5d7fb8', y: K.amber, g: '#2f9e5f', r: '#d9443a' };

// ── Props ──
export const CAT_LOAF: Grid = ['..o....o..', '.oko..oko.', 'okkkkkkkko', 'okykkkykkoo', 'okkkkkkkkko', '.ooooooooo.'];
export const CAT_PAL = { o: K.ink, k: '#2a2a33', y: '#f2c14e' };
export const PLANT_BIG: Grid = ['....L.l....', '..lLl.lLl..', '.lLllLllLl.', 'lLl.lLl.lLl', '.lLlllLllL.', 'lLllL.lLlLl', '.llLlLllLl.', '..lLlllLl..', '...lLlLl...', '....lLl....', '.....L.....'];
export const PLANT_SMALL: Grid = ['.l.L.', 'lLlLl', '.lLl.', '..L..'];
export const PLANT_HANG: Grid = ['.lLlLl.', 'lLlLlLl', 'l.L.l.L', 'L.l...l', 'l.....L', 'L......', 'l......'];
export const PLANT_PAL = { l: K.leaf, L: K.leafD };
export const CLOCK: Grid = ['..kkkkk..', '.kwwwwwk.', 'kwwwkwwwk', 'kwwwkwwwk', 'kwwwkkwwk', 'kwwwwwwwk', '.kwwwwwk.', '..kkkkk..'];
export const CLOCK_PAL = { k: K.ink, w: '#fbf6e8' };
