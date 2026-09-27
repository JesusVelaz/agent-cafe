/**
 * Hand-authored pixel sprites as palette-indexed string grids. Each character is one
 * pixel; '.' is transparent. The SpriteRegistry (registry.ts) turns grids into GPU
 * textures. To swap in a real sprite sheet later, replace the registry's texture
 * lookups; nothing else needs to change.
 */

export type Grid = readonly string[];

// ── Agents (12×20) ───────────────────────────────────────────────────────────
// o outline · h/H hair · s/S skin · e eyes · c/C shirt · p pants · b shoes

const HEAD_FRONT: Grid = [
  '...oooooo...',
  '..ohhhhhho..',
  '..ohhhhhho..',
  '..ohssssho..',
  '..osesseso..',
  '..osssssso..',
  '...oSSSSo...',
];
const HEAD_FRONT_SLEEPY: Grid = [...HEAD_FRONT.slice(0, 4), '..osSssSso..', ...HEAD_FRONT.slice(5)];
const HEAD_BACK: Grid = [
  '...oooooo...',
  '..ohhhhhho..',
  '..ohhhhhho..',
  '..ohhhhhho..',
  '..ohhhhhho..',
  '..oHhhhhHo..',
  '...oSSSSo...',
];
const TORSO: Grid = [
  '..occsscco..',
  '.occcccccco.',
  'oCccccccccCo',
  'oCccccccccCo',
  'oCccccccccCo',
  'osCccccccCso',
  '.oCccccccCo.',
];
const TORSO_TYPING: Grid = [...TORSO.slice(0, 5), 'oCsccccccsCo', TORSO[6]!];
const LEGS_STAND: Grid = [
  '.oppppppppo.',
  '.opppoopppo.',
  '.opppoopppo.',
  '.opppoopppo.',
  '.obbboobbbo.',
  '.oooooooooo.',
];
const LEGS_WALK_A: Grid = [
  '.oppppppppo.',
  '.opppoopppo.',
  '.opppoopppo.',
  '.opppoobbbo.',
  '.obbbooooo..',
  '.ooooo......',
];
const LEGS_WALK_B: Grid = [
  '.oppppppppo.',
  '.opppoopppo.',
  '.opppoopppo.',
  '.obbboopppo.',
  '..ooooobbbo.',
  '......ooooo.',
];
// Seated: three rows shorter, knees toward the viewer.
const BLANK3: Grid = ['............', '............', '............'];
const LEGS_SIT: Grid = ['.opppoopppo.', '.obbboobbbo.', '.oooooooooo.'];

export const AGENT_W = 12;
export const AGENT_H = 20;

export type AgentFrame = 'stand' | 'walkA' | 'walkB' | 'sit' | 'typeA' | 'typeB' | 'slump';

function body(head: Grid, torso: Grid, legs: Grid, seated: boolean): Grid {
  return seated ? [...BLANK3, ...head, ...torso, ...legs] : [...head, ...torso, ...legs];
}

export const AGENT_FRONT: Record<AgentFrame, Grid> = {
  stand: body(HEAD_FRONT, TORSO, LEGS_STAND, false),
  walkA: body(HEAD_FRONT, TORSO, LEGS_WALK_A, false),
  walkB: body(HEAD_FRONT, TORSO, LEGS_WALK_B, false),
  sit: body(HEAD_FRONT, TORSO, LEGS_SIT, true),
  typeA: body(HEAD_FRONT, TORSO, LEGS_SIT, true),
  typeB: body(HEAD_FRONT, TORSO_TYPING, LEGS_SIT, true),
  slump: body(HEAD_FRONT_SLEEPY, TORSO, LEGS_SIT, true),
};

export const AGENT_BACK: Record<AgentFrame, Grid> = {
  stand: body(HEAD_BACK, TORSO, LEGS_STAND, false),
  walkA: body(HEAD_BACK, TORSO, LEGS_WALK_A, false),
  walkB: body(HEAD_BACK, TORSO, LEGS_WALK_B, false),
  sit: body(HEAD_BACK, TORSO, LEGS_SIT, true),
  typeA: body(HEAD_BACK, TORSO, LEGS_SIT, true),
  typeB: body(HEAD_BACK, TORSO_TYPING, LEGS_SIT, true),
  slump: body(HEAD_BACK, TORSO, LEGS_SIT, true),
};

/** Paint the cream DEMO apron over a front frame (straps + bib). */
export function withApron(grid: Grid, seated: boolean): Grid {
  const off = seated ? 3 : 0;
  return grid.map((row, r) => {
    const tr = r - off - HEAD_FRONT.length; // row within torso
    const chars = row.split('');
    if (tr === 1 || tr === 2) {
      chars[4] = 'a';
      chars[7] = 'a';
    }
    if (tr >= 3 && tr <= 6) for (let c = 4; c <= 7; c++) chars[c] = tr === 6 ? 'A' : 'a';
    return chars.join('');
  });
}

// ── Bubble icons (7×5) ──────────────────────────────────────────────────────
// k ink · w white · g green · r red · y amber · b blue · n brown

export const ICONS = {
  calculator: ['.kkkkk.', '.kbbbk.', '.kkkkk.', '.kwkwk.', '.kkkkk.'],
  clock: ['.kkkkk.', 'kwwkwwk', 'kwwkkwk', 'kwwwwwk', '.kkkkk.'],
  book: ['.kk.kk.', 'kbbkyyk', 'kbbkyyk', 'kbbkyyk', '.kkkkk.'],
  note: ['.yyyyy.', '.ykkky.', '.yyyyy.', '.ykkyy.', '.yyyyy.'],
  hourglass: ['kkkkkkk', '.kyyyk.', '..kyk..', '.k.y.k.', 'kkkkkkk'],
  check: ['......g', '.....g.', 'g...g..', '.g.g...', '..g....'],
  alert: ['...r...', '...r...', '...r...', '.......', '...r...'],
  zzz: ['kkk....', '..k....', '.k.kkk.', 'kkk..k.', '....kkk'],
} as const satisfies Record<string, Grid>;
export type IconName = keyof typeof ICONS;

// ── Props ───────────────────────────────────────────────────────────────────

export const PLANT: Grid = [
  '...L.l...',
  '..lLlLl..',
  '.lLlllLl.',
  'lLl.lLlLl',
  '.lLlLlll.',
  '..lLlLl..',
  '...lLl...',
  '....L....',
];

export const WALL_CLOCK: Grid = [
  '..kkkkk..',
  '.kwwwwwk.',
  'kwwwkwwwk',
  'kwwwkwwwk',
  'kwwwkkwwk',
  'kwwwwwwwk',
  '.kwwwwwk.',
  '..kkkkk..',
];

export const CUP: Grid = ['.....', 'wwww.', 'wwwwk', 'wwwwk', '.ww..'];
export const CUP_FAILED: Grid = ['.....', 'rrrr.', 'rwrrk', 'rrrrk', '.rr..'];

export const TICKET: Grid = ['nnnnn', 'nkkkn', 'nnnnn', 'nkknn', 'nnnnn', 'nkkkn', 'n.n.n'];
