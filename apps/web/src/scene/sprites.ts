/**
 * Hand-authored pixel sprites as palette-indexed string grids ('.' = transparent).
 * Swapping in a real sprite sheet later only means replacing what these return.
 */
import { HAIR, K, mix, rgb, SKIN, shade, type RGB } from './palette';

export type Grid = readonly string[];

// ── Agents: chibi, 14×20 ─────────────────────────────────────────────────────
// Big heads (10 rows), 1×2 eyes with a catchlight beside them, blush. Lit from the upper left,
// so rows aren't mirrored: the left side carries highlights, the right side shade.
// Layered: head (hairstyle) + body (outfit) + legs (pose) + accessory + mood.
//   o outline · h/H/d hair (base, lit, dark) · s/S skin (base, shade) · E eye · e catchlight
//   b blush · m mouth · r tongue · c/L/C clothing (base, lit, shade) · w shirt · T/t tie
//   a/A apron · p/P trousers · k/K shoes · X hair tie · G glasses · Q/q headphones
//   B/U beanie knit · W beanie cuff · V/v visor · Y sweat drop
// agentSprite() then tints each outline pixel from the colours it borders.

export const AGENT_W = 14;
export const AGENT_H = 20;

export type HairStyle = 'short' | 'bob' | 'long' | 'ponytail' | 'curly' | 'bun';
export const HAIR_STYLES: HairStyle[] = ['short', 'bob', 'long', 'ponytail', 'curly', 'bun'];

/** Rows 0–5: crown and fringe. */
const TOP: Record<HairStyle, string[]> = {
  // Side-swept, the fringe falling to the left.
  short: ['....oooooo....', '...oHHHhhho...', '..oHHhhhhhdo..', '.oHHhhhhhhhdo.', '.oHhhhhhhhhdo.', '.ohhhhdssssho.'],
  bob: ['....oooooo....', '..ooHHHhhhoo..', '.oHHhhhhhhhdo.', 'oHHhhhhhhhhhdo', 'oHhhhhhhhhhhdo', 'ohhhhhhhhhhhdo'],
  long: ['....oooooo....', '..ooHHHhhhoo..', '.oHHhhhhhhhdo.', 'oHHhhhhhhhhhdo', 'oHhhhhhhhhhhdo', 'ohhhhhhdhhhhdo'],
  ponytail: ['....oooooo....', '...oHHHhhhoo..', '..oHHhhhhhdXo.', '.oHHhhhhhhhdho', '.oHhhhhhhhhdhd', '.ohhhhhhsssdho'],
  curly: ['...oo.oo.oo...', '..oHHoHHohho..', '.oHHhHhhhhhdo.', 'oHHhhhhhhhhhdo', 'oHhhhhhhhhhhdo', 'ohhhhhhhhhhddo'],
  bun: ['.....oooo.....', '....oHhhdo....', '..oooXXXXooo..', '.oHHhhhhhhhdo.', '.oHhhhhhhhhdo.', '.ohhsssssshdo.'],
};
/** Rows 6–9 seen from the front: eyes, blush and mouth, chin. */
const FACE = ['.ohseEseEsSho.', '.ohssEssEsSho.', '.ohsbsmmsbSho.', '..oosssssSoo..'];
/** Rows 5–9 seen from behind: hair down to the nape. */
const NAPE = ['.ohhhhhhhhhdo.', '.ohhhhhhhhhdo.', '.ohhhhhhhhddo.', '.ohhhhhhhhddo.', '..oosssssSoo..'];
/** Hair that frames the face wider than the head (rows 5–9 get extra side columns). */
const WIDE = new Set<HairStyle>(['bob', 'long', 'curly']);

export type Outfit = 'casual' | 'office' | 'apron';

const BODY: Record<Outfit, { front: string[]; back: string[]; typeA: string[]; typeB: string[] }> = {
  // Jacket with a lit left side, shirt collar and tie.
  office: {
    front: ['..oLcwSSwcCo..', '.oLLcwTTwccCo.', '.oLCccTtccCCo.', '.oLCcccTccCCo.', '.osCcccccccSo.', '..oCccccccCo..', '..oCCCooCCCo..'],
    back: ['..oLccccccCo..', '.oLLccccccCCo.', '.oLCccccccCCo.', '.oLCccccccCCo.', '.osCccccccCSo.', '..oCccccccCo..', '..oCCCCCCCCo..'],
    typeA: ['..oLcwSSwcCo..', '.oLLcwTTwccCo.', '.oLCccTtccCCo.', '.oLCcccTccCCo.', '.oLCssccSsCCo.', '..oCccccccCo..', '..oCCCooCCCo..'],
    typeB: ['..oLcwSSwcCo..', '.oLLcwTTwccCo.', '.oLCccTtccCCo.', '.oLCcssSscCCo.', '.oLCccccccCCo.', '..oCccccccCo..', '..oCCCooCCCo..'],
  },
  // Hoodie with drawstrings and a front pocket.
  casual: {
    front: ['..oLCcSScCCo..', '.oLLcwccwcCCo.', '.oLCcLccLcCCo.', '.oLCccccccCCo.', '.osCcCCCCcCSo.', '..oCcCccCcCo..', '..oCCCCCCCCo..'],
    back: ['..oLCCCCCCCo..', '.oLLcCccCcCCo.', '.oLCccCCccCCo.', '.oLCccccccCCo.', '.osCccccccCSo.', '..oCccccccCo..', '..oCCCCCCCCo..'],
    typeA: ['..oLCcSScCCo..', '.oLLcwccwcCCo.', '.oLCcLccLcCCo.', '.oLCccccccCCo.', '.oLCssCCSsCCo.', '..oCcCccCcCo..', '..oCCCCCCCCo..'],
    typeB: ['..oLCcSScCCo..', '.oLLcwccwcCCo.', '.oLCcLccLcCCo.', '.oLCcssSscCCo.', '.oLCcCCCCcCCo.', '..oCcCccCcCo..', '..oCCCCCCCCo..'],
  },
  // The barista: a shirt under a bib apron with a front pocket; ties cross at the back.
  apron: {
    front: ['..oLcaSSacCo..', '.oLLcaaaacCCo.', '.oLCaaaaaaCCo.', '.oLCaaaaaaACo.', '.osCaAAAAaASo.', '..oaaAaaAaAo..', '..oAAAAAAAAo..'],
    back: ['..oLccccccCo..', '.oLLcAccAcCCo.', '.oLCccAAccCCo.', '.oLCcAccAcCCo.', '.osAAAAAAAASo.', '..oCccccccCo..', '..oCCCCCCCCo..'],
    typeA: ['..oLcaSSacCo..', '.oLLcaaaacCCo.', '.oLCaaaaaaCCo.', '.oLCaaaaaaACo.', '.oLCssAASsCCo.', '..oaaAaaAaAo..', '..oAAAAAAAAo..'],
    typeB: ['..oLcaSSacCo..', '.oLLcaaaacCCo.', '.oLCaaaaaaCCo.', '.oLCassSsaCCo.', '.oLCaAAAAaCCo.', '..oaaAaaAaAo..', '..oAAAAAAAAo..'],
  },
};

const LEGS = {
  stand: ['...oppoopPo...', '..okKkookkko..', '..oooo..oooo..'],
  walkA: ['...oppoopPo...', '..okKko.opPo..', '..oooo..okko..'],
  walkB: ['...oppoopPo...', '..oppo.okKko..', '..okko..oooo..'],
  sit: ['...okKookKo...'],
};
const BLANK2 = ['..............', '..............'];

export type AgentFrame = 'stand' | 'walkA' | 'walkB' | 'sit' | 'typeA' | 'typeB' | 'sleep' | 'backStand' | 'backWalkA' | 'backWalkB';
export const AGENT_FRAMES: AgentFrame[] = ['stand', 'walkA', 'walkB', 'sit', 'typeA', 'typeB', 'sleep', 'backStand', 'backWalkA', 'backWalkB'];

export const isSeatedFrame = (f: AgentFrame) => f === 'sit' || f === 'typeA' || f === 'typeB' || f === 'sleep';
export const isBackFrame = (f: AgentFrame) => f.startsWith('back');

export type Accessory = 'none' | 'glasses' | 'phones' | 'visor' | 'beanie';

/**
 * What the face and one arm show about the work: squinting at a tool, eyes up
 * while thinking, a raised hand when it needs you, a grin when done, a sweat
 * drop when it failed. Front-facing frames only.
 */
export type Mood = 'focus' | 'think' | 'ask' | 'done' | 'fail';
export const MOODS: Mood[] = ['focus', 'think', 'ask', 'done', 'fail'];

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
export function agentGrid(frame: AgentFrame, look: Pick<AgentLook, 'hair' | 'outfit' | 'accessory'>, mood?: Mood): Grid {
  const back = isBackFrame(frame);
  const seated = isSeatedFrame(frame);
  const { hair } = look;
  const wide = WIDE.has(hair);

  const head = back ? [...TOP[hair].slice(0, 5), ...NAPE] : [...TOP[hair], ...FACE];
  if (back && hair === 'bun') head[5] = '.ohhhhhhhhhdo.';
  if (wide) {
    for (let r = 5; r <= 8; r++) { setPx(head, r, 0, 'o'); setPx(head, r, 1, 'h'); setPx(head, r, 12, 'd'); setPx(head, r, 13, 'o'); }
    head[9] = back ? 'ohhhhhhhhhhddo' : 'ohhosssssSoddo';
  }
  if (hair === 'ponytail' && !back) for (let r = 6; r <= 8; r++) setPx(head, r, 13, r === 8 ? 'o' : 'd');
  if (frame === 'sleep') {
    // Closed eyes: a short lash line under each.
    head[6] = head[6]!.replace(/[eE]/g, 's');
    head[7] = head[7]!.slice(0, 4) + 'ddsdd' + head[7]!.slice(9);
    head[8] = head[8]!.replace('mm', 'sm');
  }

  const b = BODY[look.outfit];
  const body = back ? b.back : frame === 'typeA' ? b.typeA : frame === 'typeB' ? b.typeB : b.front;
  const legs = seated ? LEGS.sit : frame === 'walkA' || frame === 'backWalkA' ? LEGS.walkA : frame === 'walkB' || frame === 'backWalkB' ? LEGS.walkB : LEGS.stand;
  const rows = [...head, ...body, ...legs];

  // Hair that reaches past the head.
  if (wide) { setPx(rows, 10, 1, 'o'); setPx(rows, 10, 12, 'o'); }
  if (hair === 'long') {
    if (back) {
      for (let r = 10; r <= 12; r++) for (let c = 3; c <= 10; c++) setPx(rows, r, c, c >= 9 ? 'd' : c === 3 ? 'H' : 'h');
      for (let c = 4; c <= 9; c++) setPx(rows, 13, c, c >= 8 ? 'd' : 'h');
    } else {
      for (let r = 10; r <= 12; r++) { setPx(rows, r, 0, 'o'); setPx(rows, r, 1, 'h'); setPx(rows, r, 12, 'd'); setPx(rows, r, 13, 'o'); }
      setPx(rows, 13, 1, 'o'); setPx(rows, 13, 12, 'o');
    }
  }
  if (hair === 'ponytail' && back) {
    for (let r = 8; r <= 13; r++) { setPx(rows, r, 6, r === 8 ? 'X' : 'h'); setPx(rows, r, 7, r === 8 ? 'X' : 'd'); }
    setPx(rows, 14, 6, 'o'); setPx(rows, 14, 7, 'o');
  }

  // Accessories.
  const acc = look.accessory;
  if (acc === 'glasses' && !back) {
    // Light wire frames: at this size dark frames read as a mask.
    for (let c = 3; c <= 10; c++) setPx(rows, 5, c, 'G');
    for (const r of [6, 7]) { setPx(rows, r, 3, 'G'); setPx(rows, r, 10, 'G'); }
    setPx(rows, 6, 6, 'G'); setPx(rows, 6, 7, 'G');
  }
  if (acc === 'phones') {
    for (let c = 4; c <= 9; c++) setPx(rows, 0, c, 'Q');
    setPx(rows, 1, 3, 'Q'); setPx(rows, 1, 10, 'Q'); setPx(rows, 2, 2, 'Q'); setPx(rows, 2, 11, 'Q');
    for (const r of [5, 6, 7, 8]) {
      const edge = r === 5 || r === 8;
      setPx(rows, r, 0, edge ? 'o' : 'Q'); setPx(rows, r, 1, r === 6 ? 'q' : 'Q');
      setPx(rows, r, 12, 'Q'); setPx(rows, r, 13, edge ? 'o' : 'Q');
    }
  }
  if (acc === 'visor') for (let c = 1; c <= 12; c++) { setPx(rows, 3, c, 'V'); if (!back && c >= 2 && c <= 11) setPx(rows, 4, c, 'v'); }
  if (acc === 'beanie') {
    rows[0] = '....oooooo....';
    rows[1] = '..oBUBUBUBUo..';
    rows[2] = '.oBUBUBUBUBUo.';
    rows[3] = '.oBUBUBUBUBUo.';
    rows[4] = 'oWWWWWWWWWWWWo';
  }

  if (mood && !back && frame !== 'sleep') applyMood(rows, mood);
  return seated ? [...BLANK2, ...rows] : rows;
}

function applyMood(rows: string[], mood: Mood) {
  const put = (r: number, c: number, ch: string) => setPx(rows, r, c, ch);
  const span = (r: number, c: number, s: string) => [...s].forEach((ch, i) => put(r, c + i, ch));
  switch (mood) {
    case 'focus': // brows drawn in, mouth set
      put(5, 5, 'd'); put(5, 8, 'd'); put(8, 6, 'o'); put(8, 7, 'o');
      break;
    case 'think': // eyes up and aside, a hand at the chin
      span(6, 3, 'sEesEe'); span(7, 3, 'ssssss');
      put(8, 6, 's'); put(8, 7, 'm');
      put(9, 8, 's'); put(10, 8, 's'); put(9, 9, 'S'); put(10, 9, 'o'); put(11, 8, 'c'); put(11, 9, 'C');
      break;
    case 'ask': // hand up
      for (let r = 5; r <= 11; r++) { put(r, 12, r === 11 ? 'C' : 'c'); put(r, 13, 'o'); }
      put(2, 12, 'o'); put(3, 12, 'o'); put(3, 13, 'o'); put(4, 12, 's'); put(4, 13, 'o');
      break;
    case 'done': // ^^ eyes and an open smile
      span(6, 3, 'sEEssEEs'); span(7, 3, 'EssEEssE');
      put(8, 6, 'E'); put(8, 7, 'E'); put(9, 6, 'r'); put(9, 7, 'r');
      break;
    case 'fail': // worried brows, a wobbly mouth, a sweat drop
      put(5, 4, 'd'); put(5, 9, 'd');
      span(8, 5, 'msms'); put(9, 6, 'm');
      put(4, 12, 'Y'); put(5, 12, 'Y'); put(5, 13, 'Y'); put(4, 13, 'o');
      break;
  }
}

/** A grid with its outlines resolved: every char maps to a colour in `palette`. */
export interface AgentSprite {
  grid: Grid;
  palette: Record<string, string>;
}

const OUTLINE_KEYS = 0xe000; // private-use chars for the per-sprite outline colours
const spriteCache = new Map<string, AgentSprite>();

/**
 * The frame ready to draw. Outline pixels take a dark tone of the colours they
 * border (brown around skin, deep navy around a navy jacket) instead of one ink
 * colour; edges against the background stay a little closer to ink.
 */
export function agentSprite(frame: AgentFrame, look: AgentLook, mood?: Mood): AgentSprite {
  const key = `${frame}|${mood ?? ''}|${look.hair}|${look.outfit}|${look.accessory}|${look.palette.h}${look.palette.s}${look.palette.c}${look.palette.T}${look.palette.B}${look.palette.X}`;
  const hit = spriteCache.get(key);
  if (hit) return hit;
  const g = agentGrid(frame, look, mood);
  const pal = look.palette;
  const out: Record<string, string> = { ...pal };
  const tones = new Map<string, string>();
  const at = (x: number, y: number) => g[y]?.[x] ?? '.';
  const grid = g.map((row, y) => [...row].map((ch, x) => {
    if (ch !== 'o') return ch;
    const ns = [at(x, y + 1), at(x, y - 1), at(x - 1, y), at(x + 1, y)];
    const fills = ns.filter((n) => n !== '.' && n !== 'o' && pal[n]);
    if (!fills.length) return ch;
    const sum: RGB = [0, 0, 0];
    for (const n of fills) { const c = rgb(pal[n]!); sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; }
    const avg = '#' + sum.map((v) => Math.round(v / fills.length).toString(16).padStart(2, '0')).join('');
    const col = ns.includes('.') ? mix(shade(avg, -0.62), K.ink, 0.25) : shade(avg, -0.45);
    let k = tones.get(col);
    if (!k) { k = String.fromCharCode(OUTLINE_KEYS + tones.size); tones.set(col, k); out[k] = col; }
    return k;
  }).join(''));
  const sprite = { grid, palette: out };
  if (spriteCache.size > 4000) spriteCache.clear();
  spriteCache.set(key, sprite);
  return sprite;
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
const SHIRTS = ['#efe7da', '#3a3f47', '#c9b79c'];
const HOODIES = ['#d9a441', '#4f9aa5', '#c46b4e', '#8a6fb8', '#5d7fb8', '#7a8c4a', '#e8b4b8', '#6b4a3a'];
const HAIR_TIES = [K.berry, K.teal, K.amber, '#8a6fb8'];

/**
 * Deterministic look from an agent's spriteSeed (an agent always looks the
 * same). The outfit comes from the floor: casual hoodies downstairs (OpenAI),
 * office wear upstairs (Anthropic).
 */
export function agentLook(seed: number, outfit: Outfit): AgentLook {
  const rnd = seeded(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
  const base = pick(['short', 'bob', 'long', 'ponytail'] as const);
  const hairCol = pick(HAIR);
  const skin = pick(SKIN);
  const accessory = pick(['none', 'glasses', 'phones', 'beanie', 'none'] as const);
  const cloth = outfit === 'office' ? pick(JACKETS) : outfit === 'apron' ? pick(SHIRTS) : pick(HOODIES);
  const beanie = pick(['#5d7fb8', '#b5536a', '#e0a84a']);
  const tie = pick(TIES);
  // A second stream for what came later, so existing agents keep their colours.
  const more = seeded(seed * 31 + 7);
  const r = more();
  const hair: HairStyle = base === 'short' && r < 0.45 ? 'curly' : base === 'bob' && r < 0.4 ? 'bun' : base === 'long' && r < 0.25 ? 'curly' : base;
  const hairTie = HAIR_TIES[Math.floor(more() * HAIR_TIES.length)]!;
  return {
    hair,
    outfit,
    accessory,
    palette: {
      o: K.ink, E: '#1e1512', e: '#ffffff', b: '#f09a8f', r: '#d9706a', Y: '#8fd3ff',
      h: hairCol, H: shade(hairCol, 0.28), d: shade(hairCol, -0.32), X: hairTie,
      s: skin, S: shade(skin, -0.13), m: shade(skin, -0.45),
      c: cloth, L: shade(cloth, 0.16), C: shade(cloth, -0.28),
      w: '#fbf6ec', T: tie, t: shade(tie, -0.25),
      a: '#4a6b52', A: '#3a5541', p: '#33313f', P: '#25232f', k: '#3a2a22', K: '#7a5a46',
      G: '#c4bcb0', Q: '#3a3f47', q: '#8b95a3', B: beanie, U: shade(beanie, -0.22), W: '#efe7da', V: '#4a6b52', v: '#5f8568',
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
/** The clock without hands; the hands are drawn from the real time. */
export const CLOCK_FACE: Grid = ['..kkkkk..', '.kwwwwwk.', 'kwwwwwwwk', 'kwwwwwwwk', 'kwwwwwwwk', 'kwwwwwwwk', '.kwwwwwk.', '..kkkkk..'];

// ── Ambient critters ──
/** A distant bird, wings up then down. */
export const BIRD: readonly Grid[] = [['k...k', '.k.k.', '..k..'], ['.....', 'kk.kk', '..k..']];
/** Side-on pigeon facing right: standing, then pecking. g body · G tail · h head · b beak · o feet. */
export const PIGEON: readonly Grid[] = [
  ['....hh.', '.gggghb', 'Gggggg.', '..o.o..'],
  ['.......', '.gggg..', 'Gggggh.', '..o.ohb'],
];
export const PIGEON_PAL = { g: '#9aa0ab', G: '#6f7480', h: '#5c6a7a', b: '#e0a84a', o: '#c46b6b' };
/**
 * A beagle, side-on facing right (17×11), painted from layers like the agents: a
 * low body with a saddle and collar, legs, a wagging tail, and a head that drops
 * to the ground to sniff.
 *   o outline · k tan fur · l light fur · d dark ear and saddle · w white muzzle, chest,
 *   paws and tail tip · e eye · n nose · c collar
 */
export type DogFrame = 'stand' | 'strideA' | 'strideB' | 'sniff';
export const DOG_W = 17;
const DOG_H = 11;
const DOG_HEAD = ['..ooo...', '.olllo..', 'oddkeko.', 'oddkkwwn', 'oddkwwwo', '.ooooo..'];
const DOG_BODY = ['oooooocc....', 'okdddkcckwwo', 'okkkkkkkkwwo', '.okllllkkwo.', '..ooooooooo.'];
const DOG_LEGS: Record<Exclude<DogFrame, 'sniff'>, string[]> = {
  stand: ['.dk.....dk..', '.dw.....dw..'],
  strideA: ['d..k...d..k.', 'd..w..d...w.'],
  strideB: ['.kd.....kd..', '.wd.....wd..'],
};
const DOG_TAIL = { up: ['o..', 'wo.', 'ko.', '.k.'], down: ['...', 'o..', 'wko', '..k'] };
/** Where the lead clips on, in grid cells (the collar, behind the ear). */
export const DOG_COLLAR = { x: 8, y: 4 };

export function dogGrid(frame: DogFrame, wag: boolean): Grid {
  const g = Array.from({ length: DOG_H }, () => Array<string>(DOG_W).fill('.'));
  const paint = (rows: string[], x: number, y: number) => rows.forEach((r, j) => [...r].forEach((ch, i) => { if (ch !== '.') g[y + j]![x + i] = ch; }));
  paint(wag ? DOG_TAIL.down : DOG_TAIL.up, 0, 1);
  paint(DOG_BODY, 2, 4);
  paint(DOG_LEGS[frame === 'sniff' ? 'stand' : frame], 2, 9);
  paint(DOG_HEAD, 9, frame === 'sniff' ? 5 : 0); // nose to the ground
  return g.map((r) => r.join(''));
}
export const DOG_PAL = { o: K.ink, k: '#c98f55', l: '#e3b27a', d: '#7a4a2a', w: '#f6efe2', e: '#1e1512', n: '#1e1512', c: K.berry };
/** Butterfly, wings open then closed. */
export const BUTTERFLY: readonly Grid[] = [['w.w', '.k.'], ['.w.', '.k.']];
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
