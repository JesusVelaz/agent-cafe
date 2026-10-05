/**
 * Hand-authored pixel sprites as palette-indexed string grids ('.' = transparent).
 * Swapping in a real sprite sheet later only means replacing what these return.
 */
import { HAIR, K, SKIN, shade } from './palette';

export type Grid = readonly string[];

// ── Agents: chibi, 14×20 ─────────────────────────────────────────────────────
// Big heads (10 rows), 2-pixel eyes, blush. Built from symmetric halves that are
// mirrored, then layered: head (hairstyle) + body (outfit) + legs (pose) + accessory.
//   o outline · h/H hair · s skin · E eyes · b blush · m mouth · w shirt · T tie
//   c/C clothing · a/A apron · p pants · k shoes

export const AGENT_W = 14;
export const AGENT_H = 20;

const sym = (half: string) => half + [...half].reverse().join('');
const S = (halves: string[]) => halves.map(sym);

const HEAD_TOP = S(['....ooo', '...ohhh', '..ohhhh', '.ohhhhh', '.ohHhhh']);

export type HairStyle = 'short' | 'bob' | 'long' | 'ponytail';

const FACE: Record<HairStyle, string[]> = {
  short: S(['.ohhsss', '.ohssEs', '.ohssEs', '.ohsbsm', '..ossss']),
  bob: S(['.ohhhss', '.ohssEs', '.ohssEs', '.ohsbsm', '.ohosss']),
  long: S(['.ohhhss', '.ohssEs', '.ohssEs', '.ohsbsm', '.ohosss']),
  ponytail: S(['.ohhsss', '.ohssEs', '.ohssEs', '.ohsbsm', '..ossss']),
};
const HEAD_BACK = [...HEAD_TOP, ...S(['.ohhhhh', '.ohhhhh', '.ohHhhh', '.ohhhhh', '..ohhhh'])];

export type Outfit = 'casual' | 'office';

const BODY: Record<Outfit, { front: string[]; typing: string[]; back: string[] }> = {
  office: {
    front: S(['...oCcw', '..oCccT', '.oCcccT', '.oCcccc', '.osCccc', '..oCccc', '..oCCCC']),
    typing: S(['...oCcw', '..oCccT', '.oCcccT', '.oCcccc', '.oCcssc', '..oCccc', '..oCCCC']),
    back: S(['...oCcc', '..oCccc', '.oCcccc', '.oCcccc', '.osCccc', '..oCccc', '..oCCCC']),
  },
  // Hoodie with drawstrings and a front pocket.
  casual: {
    front: S(['...oCcc', '..oCcwc', '.oCccwc', '.oCcccc', '.osCcCC', '..oCccc', '..oCCCC']),
    typing: S(['...oCcc', '..oCcwc', '.oCccwc', '.oCcccc', '.oCcsCC', '..oCccc', '..oCCCC']),
    back: S(['...oCCC', '..oCccc', '.oCcccc', '.oCcccc', '.osCccc', '..oCccc', '..oCCCC']),
  },
};

const LEGS = {
  stand: S(['...oppo', '...okko', '...oooo']),
  walkA: ['...oppooppo...', '...okko.oppo..', '...oooo.okko..'],
  walkB: ['...oppooppo...', '..oppo.okko...', '..okko.oooo...'],
  sit: S(['...okko']),
};
const BLANK2 = ['..............', '..............'];

export type AgentFrame = 'stand' | 'walkA' | 'walkB' | 'sit' | 'typeA' | 'typeB' | 'sleep' | 'backStand' | 'backWalkA' | 'backWalkB';
export const AGENT_FRAMES: AgentFrame[] = ['stand', 'walkA', 'walkB', 'sit', 'typeA', 'typeB', 'sleep', 'backStand', 'backWalkA', 'backWalkB'];

export const isSeatedFrame = (f: AgentFrame) => f === 'sit' || f === 'typeA' || f === 'typeB' || f === 'sleep';
export const isBackFrame = (f: AgentFrame) => f.startsWith('back');

export type Accessory = 'none' | 'glasses' | 'phones' | 'visor' | 'beanie';

export interface AgentLook {
  hair: HairStyle;
  outfit: Outfit;
  accessory: Accessory;
  palette: Record<string, string>;
}

function setPx(rows: string[], r: number, c: number, ch: string) {
  const row = rows[r];
  if (row === undefined || c < 0 || c >= row.length) return;
  rows[r] = row.slice(0, c) + ch + row.slice(c + 1);
}

/** Compose one animation frame for a look. */
export function agentGrid(frame: AgentFrame, look: Pick<AgentLook, 'hair' | 'outfit' | 'accessory'>): Grid {
  const back = isBackFrame(frame);
  const seated = isSeatedFrame(frame);
  let head = back ? [...HEAD_BACK] : [...HEAD_TOP, ...FACE[look.hair]];
  if (frame === 'sleep') head = head.map((r, i) => (i === 6 ? r.replaceAll('E', 's') : i === 7 ? r.replaceAll('E', 'o') : r));
  const b = BODY[look.outfit];
  const body = back ? b.back : frame === 'typeB' ? b.typing : b.front;
  const legs = seated ? LEGS.sit : frame === 'walkA' || frame === 'backWalkA' ? LEGS.walkA : frame === 'walkB' || frame === 'backWalkB' ? LEGS.walkB : LEGS.stand;
  const rows = [...head, ...body, ...legs];

  // Hair that reaches past the head.
  if (look.hair === 'long') {
    if (back) for (let r = 10; r <= 13; r++) for (let c = 3; c <= 10; c++) setPx(rows, r, c, 'h');
    else for (let r = 10; r <= 12; r++) { setPx(rows, r, 2, 'h'); setPx(rows, r, 11, 'h'); }
  }
  if (look.hair === 'ponytail') {
    if (back) for (let r = 8; r <= 12; r++) { setPx(rows, r, 6, 'h'); setPx(rows, r, 7, 'H'); }
    else { for (let r = 3; r <= 8; r++) setPx(rows, r, 13, r % 2 ? 'h' : 'H'); setPx(rows, 9, 13, 'o'); }
  }
  // Accessories.
  if (look.accessory === 'glasses' && !back) {
    // Light frames around the eyes (a solid dark bar reads as sunglasses).
    for (const c of [4, 5, 8, 9]) setPx(rows, 5, c, 'G');
    for (const r of [6, 7]) for (const c of [3, 6, 7, 10]) setPx(rows, r, c, 'G');
  }
  if (look.accessory === 'phones') {
    for (let c = 4; c <= 9; c++) setPx(rows, 0, c, 'Q');
    for (const r of [5, 6, 7]) { setPx(rows, r, 0, 'Q'); setPx(rows, r, 13, 'Q'); }
    setPx(rows, 1, 3, 'Q'); setPx(rows, 1, 10, 'Q');
  }
  if (look.accessory === 'visor') for (let c = 1; c <= 12; c++) { setPx(rows, 3, c, 'V'); if (!back && c >= 3 && c <= 10) setPx(rows, 4, c, 'v'); }
  if (look.accessory === 'beanie') {
    rows[1] = sym('...oBBB'); rows[2] = sym('..oBBBB'); rows[3] = sym('.oBBBBB'); rows[4] = sym('.oWWWWW');
  }
  return seated ? [...BLANK2, ...rows] : rows;
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

const JACKETS = ['#34405a', '#4a3a57', '#5b4a3c', '#2f4f4f', '#6b3f3f', '#3d4a3a'];
const TIES = [K.berry, K.teal, K.amber, '#8a6fb8', '#e76f51'];
const HOODIES = ['#d9a441', '#4f9aa5', '#c46b4e', '#8a6fb8', '#5d7fb8', '#7a8c4a', '#e8b4b8', '#6b4a3a'];

/**
 * Deterministic look from an agent's spriteSeed (an agent always looks the
 * same). The outfit comes from the floor: casual hoodies downstairs (OpenAI),
 * office wear upstairs (Anthropic).
 */
export function agentLook(seed: number, outfit: Outfit): AgentLook {
  const rnd = seeded(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const hair = pick(['short', 'bob', 'long', 'ponytail'] as const);
  const hairCol = pick(HAIR);
  const skin = pick(SKIN);
  const accessory = pick(['none', 'glasses', 'phones', 'beanie', 'none'] as const);
  const cloth = outfit === 'office' ? pick(JACKETS) : pick(HOODIES);
  return {
    hair,
    outfit,
    accessory,
    palette: {
      o: K.ink, E: '#1e1512', G: '#a08672', Q: '#3a3f47', V: '#4a6b52', v: '#5f8568', B: pick(['#5d7fb8', '#b5536a', '#e0a84a']), W: '#efe7da',
      h: hairCol, H: shade(hairCol, 0.22), s: skin, b: '#f09a8f', m: shade(skin, -0.35),
      w: '#fbf6ec', T: pick(TIES), c: cloth, C: shade(cloth, -0.25),
      a: '#4a6b52', A: '#3a5541', p: '#2e2c3a', k: '#3a2a22',
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
  term: ['kkkkkkk', 'kgkkkkk', 'kkgkkkk', 'kgkkggk', 'kkkkkkk'],
  pen: ['.....kk', '....kyk', '...kyk.', '..kyk..', '.bk....'],
  ask: ['..bbb..', '.b...b.', '....b..', '.......', '...b...'],
} as const satisfies Record<string, Grid>;
export type IconName = keyof typeof ICONS;
export const ICON_PAL = { k: K.ink, w: '#ffffff', b: '#5d7fb8', y: K.amber, g: '#2f9e5f', r: '#d9443a' };

// ── Props ──
// ── Cats: side-on, facing screen-right (flip for left) ──
//   o outline · k fur · d darker fur (stripes, tail) · w white · y eyes · n nose
export const CAT = {
  walkA: ['..o......o.o.', '.oko....okkko', '.oko....okkyo', '..oooooookkwo', '..okdkdkkkwo.', '..okkkkkkkko.', '...d.d..d.d..', '...o.o..o.o..'],
  walkB: ['.o.......o.o.', 'oko.....okkko', '.oko....okkyo', '..oooooookkwo', '..okdkdkkkwo.', '..okkkkkkkko.', '...dd....dd..', '...oo....oo..'],
  sit: ['.....o..o.', '....okkkko', '....okykyo', '....okknko', '...ookwwo.', '...okkwwo.', '..okkkkwo.', '.okdkkkko.', 'okddkwkwo.', '.oooooooo.'],
  loaf: ['.......o..o.', '..oooookkkko', '.okdkdkkykyo', 'okkkkkkkknko', 'okkkkkkkwwwo', '.oooooooooo.'],
  sleep: ['..oooo.o.o.', '.okkdkokkko', 'okkkdkkdkwo', 'okddddddkko', '.ooooooooo.'],
} as const satisfies Record<string, Grid>;
export type CatFrame = keyof typeof CAT;

/** Ink (tuxedo), Marmalade (ginger tabby), Pebble (grey). */
export const CAT_FURS: ReadonlyArray<Record<string, string>> = [
  { o: K.ink, k: '#3a3a46', d: '#26262f', w: '#ece6da', y: '#f2c14e', n: '#d98a8a' },
  { o: K.ink, k: '#e3924a', d: '#bf6d2e', w: '#f7e6c8', y: '#6aa35a', n: '#d9706a' },
  { o: K.ink, k: '#9aa0aa', d: '#767c87', w: '#e8eaee', y: '#f2c14e', n: '#d98a8a' },
];
export const PLANT_SMALL: Grid = ['.l.L.', 'lLlLl', '.lLl.', '..L..'];
export const PLANT_HANG: Grid = ['.lLlLl.', 'lLlLlLl', 'l.L.l.L', 'L.l...l', 'l.....L', 'L......', 'l......'];
export const PLANT_PAL = { l: K.leaf, L: K.leafD };
/** Fiddle-leaf fig (13×15): g highlight · l leaf · L dark leaf · t stem. */
export const FIG: Grid = [
  '.....gLg.....',
  '...glLLlg....',
  '..gLLlLLLl...',
  '..lLl.lLLg.g.',
  '.g.gLlLl.glLg',
  'glLlLL.LllLLl',
  '.lLLlg.lLLLl.',
  '..lLl..glLl..',
  '.gLlLg..t....',
  'glLLLl..t.gLg',
  '.lLLl..ttlLLl',
  '..gl...t.lLl.',
  '.......t.....',
  '......tt.....',
  '......t......',
];
export const FIG_PAL = { g: '#9fd07a', l: K.leaf, L: '#3f7a3a', t: '#6b4a33' };
/** Trailing pothos (7×7) for hanging pots and shelf tops. */
export const POTHOS: Grid = ['.gLlLg.', 'gLlLlLg', 'L.lLl.L', 'l..L..l', 'L..l..g', 'g..L...', '...g...'];
export const POTHOS_PAL = { g: '#9fd07a', l: K.leaf, L: '#3f7a3a' };
export const CLOCK: Grid = ['..kkkkk..', '.kwwwwwk.', 'kwwwkwwwk', 'kwwwkwwwk', 'kwwwkkwwk', 'kwwwwwwwk', '.kwwwwwk.', '..kkkkk..'];
export const CLOCK_PAL = { k: K.ink, w: '#fbf6e8' };
/** Tree canopy (15×13): L dark leaf · l leaf · g highlight. */
export const TREE: Grid = [
  '.....LLlL......',
  '...LlllglLL....',
  '..LlgllllllL...',
  '.LllllglllllL..',
  'LlglllllllgllL.',
  'LllllLllllllllL',
  '.LlllllllgllllL',
  'LllglllllllLlL.',
  '.LlllLlllllllL.',
  '..LLlllllglLL..',
  '...LLllllLL....',
  '.....LLLLL.....',
  '.......o.......',
];
