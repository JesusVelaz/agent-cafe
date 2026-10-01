/**
 * The Agent Café mark: a pixel coffee cup on a 16×16 grid. One definition drives the
 * top-bar logo, the static favicon (app/icon.svg) and the live favicon, which steams
 * while agents work and carries a coral dot when one needs you.
 *   o outline · w cup · c crema · r coffee · b saucer · s steam (frame A) · t steam (frame B)
 */
export const CUP: readonly string[] = [
  '................',
  '....ts.ts.......',
  '....st.st.......',
  '....ts.ts.......',
  '................',
  '..oooooooooo....',
  '..ocrrrrrrco....',
  '..owccccccwoooo.',
  '..owwwwwwwwo..o.',
  '..owwwwwwwwo..o.',
  '..owwwwwwwwoooo.',
  '...owwwwwwo.....',
  '...owwwwwwo.....',
  '.oooooooooooo...',
  '..obbbbbbbbo....',
  '................',
];

export const CUP_PAL: Record<string, string> = {
  o: '#2b1d17',
  w: '#f3e6cc',
  c: '#c9975f',
  r: '#6b3f22',
  b: '#b08a5c',
  s: '#cfd6e6',
  t: '#cfd6e6',
};

export const TILE = '#17191e';
export const BADGE = '#ff8a6b';

export interface Px {
  x: number;
  y: number;
  fill: string;
  /** Which steam frame the pixel belongs to (absent: always drawn). */
  steam?: 's' | 't';
}

export function cupPixels(): Px[] {
  const out: Px[] = [];
  CUP.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      out.push({ x, y, fill: CUP_PAL[ch]!, ...(ch === 's' || ch === 't' ? { steam: ch } : {}) });
    }),
  );
  return out;
}

/** A standalone SVG (for favicons): dark rounded tile, cup, optional steam and badge. */
export function cupSvg({ steam = false, badge = false }: { steam?: boolean; badge?: boolean } = {}): string {
  const rects = cupPixels()
    .filter((p) => !p.steam || (steam && p.steam === 's'))
    .map((p) => `<rect x="${p.x}" y="${p.y}" width="1" height="1" fill="${p.fill}"/>`)
    .join('');
  const dot = badge ? `<rect x="11" y="0" width="5" height="5" fill="${BADGE}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><rect width="16" height="16" rx="3" fill="${TILE}"/>${rects}${dot}</svg>`;
}

export const cupDataUrl = (o: { steam?: boolean; badge?: boolean }) => `data:image/svg+xml,${encodeURIComponent(cupSvg(o))}`;
