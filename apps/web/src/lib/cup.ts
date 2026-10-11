/**
 * The Agents Café mark: a pixel coffee cup with a face, on a 16×16 grid. Its mood is the
 * café's: dozing when nothing runs, awake and steaming while agents work, wide-eyed
 * with a coral dot when one needs you. One definition drives the top-bar logo, the
 * static favicon (app/icon.svg) and the live favicon.
 *   o outline · w cup · c crema · r coffee · b saucer · e face · p cheek
 *   s steam (frame A) · t steam (frame B) · z snore · k alert dot
 */
export type Mood = 'quiet' | 'working' | 'alert';

/** What floats above the cup (rows 0–3). */
const ABOVE: Record<Mood, readonly string[]> = {
  quiet: [
    '...........zzzz.',
    '.............z..',
    '............z...',
    '...........zzzz.',
  ],
  working: [
    '................',
    '....ts.ts.......',
    '....st.st.......',
    '....ts.ts.......',
  ],
  alert: [
    '............kk..',
    '...........kkkk.',
    '...........kkkk.',
    '............kk..',
  ],
};

/** The face on the cup's body (rows 8–12). */
const FACE: Record<Mood, readonly string[]> = {
  quiet: [
    '..owwwwwwwwo..o.',
    '..oweewweewo..o.',
    '..owpwwwwpwoooo.',
    '...owweewwo.....',
    '...owwwwwwo.....',
  ],
  working: [
    '..owwewwewwo..o.',
    '..owwewwewwo..o.',
    '..owpwwwwpwoooo.',
    '...owewwewo.....',
    '...owweewwo.....',
  ],
  alert: [
    '..oweewweewo..o.',
    '..oweewweewo..o.',
    '..owpwwwwpwoooo.',
    '...owweewwo.....',
    '...owweewwo.....',
  ],
};

function cupRows(mood: Mood): readonly string[] {
  return [
    ...ABOVE[mood],
    '................',
    '..oooooooooo....',
    '..ocrrrrrrco....',
    '..owccccccwoooo.',
    ...FACE[mood],
    '.oooooooooooo...',
    '..obbbbbbbbo....',
    '................',
  ];
}

const CUP_PAL: Record<string, string> = {
  o: '#2b1d17',
  w: '#f3e6cc',
  c: '#c9975f',
  r: '#6b3f22',
  b: '#b08a5c',
  e: '#2b1d17',
  p: '#e8a08a',
  s: '#cfd6e6',
  t: '#cfd6e6',
  z: '#a3a9b5',
  k: '#ff8a6b',
};

export interface Px {
  x: number;
  y: number;
  fill: string;
  /** Which steam frame the pixel belongs to (absent: always drawn). */
  steam?: 's' | 't';
}

export function cupPixels(mood: Mood): Px[] {
  const out: Px[] = [];
  cupRows(mood).forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      out.push({ x, y, fill: CUP_PAL[ch]!, ...(ch === 's' || ch === 't' ? { steam: ch } : {}) });
    }),
  );
  return out;
}

/** A standalone SVG (for favicons): the cup in that mood on a transparent background, steam frozen on frame A. */
export function cupSvg(mood: Mood): string {
  const rects = cupPixels(mood)
    .filter((p) => p.steam !== 't')
    .map((p) => `<rect x="${p.x}" y="${p.y}" width="1" height="1" fill="${p.fill}"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">${rects}</svg>`;
}

export const cupDataUrl = (mood: Mood) => `data:image/svg+xml,${encodeURIComponent(cupSvg(mood))}`;

/** The cup's inside, top to bottom: the rows the first-load fill rises through. */
const INSIDE_TOP = 6;
const INSIDE_BOTTOM = 12;
export const CUP_FILL_ROWS = INSIDE_BOTTOM - INSIDE_TOP + 1;
const EMPTY = '#262a31';

/**
 * The cup with nothing in it yet, filled from the bottom to `level` (0–1, in whole
 * rows) with coffee under a line of crema: the first-load meter. Same outline as the
 * logo, no face and no steam; it wakes into the logo once full.
 */
export function cupFillPixels(level: number): Px[] {
  const filled = Math.round(Math.min(1, Math.max(0, level)) * CUP_FILL_ROWS);
  const surface = INSIDE_BOTTOM - filled + 1;
  const out: Px[] = [];
  cupRows('working').forEach((row, y) => {
    if (y < 4) return; // nothing above an empty cup
    const left = row.indexOf('o');
    const right = row.indexOf('o', left + 1);
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const inside = y >= INSIDE_TOP && y <= INSIDE_BOTTOM && x > left && x < right;
      if (!inside) out.push({ x, y, fill: CUP_PAL[ch]! });
      else out.push({ x, y, fill: y < surface ? EMPTY : y === surface ? CUP_PAL.c! : CUP_PAL.r! });
    });
  });
  return out;
}
