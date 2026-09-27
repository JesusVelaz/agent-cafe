/**
 * A 3×5 bitmap font for in-scene signage (menu board, floor labels, name tags).
 * Drawn as 1px rects so it stays crisp at the scene's native resolution.
 */
import type { Graphics } from 'pixi.js';

/** Each glyph: 5 rows of 3 columns, '#' = ink. */
const GLYPHS: Record<string, readonly string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  ',': ['...', '...', '...', '.#.', '#..'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '-': ['...', '...', '###', '...', '...'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '·': ['...', '...', '.#.', '...', '...'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  $: ['.##', '##.', '.#.', '.##', '##.'],
  '%': ['#..', '..#', '.#.', '#..', '..#'],
  "'": ['.#.', '.#.', '...', '...', '...'],
  '(': ['.#.', '#..', '#..', '#..', '.#.'],
  ')': ['.#.', '..#', '..#', '..#', '.#.'],
  '&': ['.#.', '#.#', '.#.', '#.#', '.##'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
};

export const GLYPH_W = 3;
export const GLYPH_H = 5;

export const hasGlyph = (ch: string) => ch.toUpperCase() in GLYPHS;
export const glyphRows = (ch: string) => GLYPHS[ch.toUpperCase()] ?? GLYPHS['?']!;

export function textWidth(text: string, scale = 1, spacing = 1): number {
  return text.length === 0 ? 0 : (text.length * (GLYPH_W + spacing) - spacing) * scale;
}

export interface TextOpts {
  color: string;
  /** Pixel size multiplier. */
  scale?: number;
  spacing?: number;
  /** Vertical px shift per horizontal px: 0.5 for the right wall, -0.5 for the left. */
  slope?: number;
  /** Outline colour drawn around each ink pixel (for readability over busy art). */
  outline?: string;
}

/** Draws `text` with its top-left at (x, y). */
export function drawText(g: Graphics, text: string, x: number, y: number, opts: TextOpts) {
  const s = opts.scale ?? 1;
  const spacing = opts.spacing ?? 1;
  const slope = opts.slope ?? 0;
  const pixels: Array<[number, number]> = [];
  let cx = 0;
  for (const ch of text) {
    const rows = glyphRows(ch);
    rows.forEach((row, r) => {
      for (let c = 0; c < GLYPH_W; c++) if (row[c] === '#') pixels.push([cx + c, r]);
    });
    cx += GLYPH_W + spacing;
  }
  const at = (px: number, py: number) => ({
    x: x + px * s,
    y: y + py * s + Math.round(px * s * slope),
  });
  if (opts.outline) {
    for (const [px, py] of pixels) {
      const p = at(px, py);
      g.rect(p.x - 1, p.y - 1, s + 2, s + 2).fill(opts.outline);
    }
  }
  for (const [px, py] of pixels) {
    const p = at(px, py);
    g.rect(p.x, p.y, s, s).fill(opts.color);
  }
}
