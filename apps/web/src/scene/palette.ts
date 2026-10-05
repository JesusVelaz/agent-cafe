/** The café's colours and small colour helpers. UI tokens in globals.css share these values. */

export const K = {
  ink: '#2b1d17',
  cream: '#f3e6cc',
  creamShade: '#d9cba8',
  plaster: '#ecdcbf',
  plasterShade: '#dcc8a6',
  sage: '#b3c29e',
  sageShade: '#9eae88',
  wains: '#7c4a32',
  wainsDark: '#5e3522',
  trim: '#4f2c1c',
  cap: '#f5ecdb',
  capSide: '#d8c7a8',
  cocoa: '#7b5443',
  creamTile: '#eadbb9',
  plank: '#c9975f',
  plankL: '#d6a66d',
  plankD: '#b9864f',
  wood: '#8a5534',
  woodL: '#a86b40',
  woodD: '#5f3822',
  counterTop: '#d9b07a',
  metal: '#b9c1c8',
  metalD: '#737d86',
  glass: '#bfe3ea',
  brass: '#e0a84a',
  bulb: '#fff1c2',
  leaf: '#6aa35a',
  leafD: '#477f3d',
  leafL: '#8fc26f',
  pot: '#b86a42',
  potD: '#8e4c2c',
  berry: '#b5536a',
  teal: '#4f9aa5',
  rug: '#b0563f',
  rugL: '#d98a5f',
  rugD: '#7e3a2b',
  rugBorder: '#e6c99a',
  slab: '#5a3a2a',
  slabTop: '#6b4632',
  screen: '#9fe3dc',
  white: '#fffaf0',
  coral: '#e76f51',
  amber: '#f2c14e',
  // Furniture materials.
  ceramic: '#efe6d6',
  ceramicD: '#9b8f7f',
  marble: '#f0e9de',
  vein: '#cbc2b4',
  velvet: '#3f6b5a',
  mustard: '#d39a3a',
  slat: '#a9b98f',
  slatD: '#86966f',
  chrome: '#d7dde2',
  chromeD: '#8d969e',
} as const;

export type RGB = [number, number, number];

const cache = new Map<string, RGB>();
export function rgb(hex: string): RGB {
  let v = cache.get(hex);
  if (!v) {
    const h = hex.replace('#', '');
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    cache.set(hex, v);
  }
  return v;
}

function hx(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** k > 0 lightens toward white, k < 0 darkens toward black. */
export function shade(hex: string, k: number): string {
  const c = rgb(hex);
  const t = k < 0 ? 0 : 255;
  const a = Math.abs(k);
  return hx(c[0] + (t - c[0]) * a, c[1] + (t - c[1]) * a, c[2] + (t - c[2]) * a);
}

export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hx(x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t);
}

/** Deterministic 0..1 hash for per-tile variation (plank shades, book colours). */
export function hash(n: number): number {
  n = (n ^ 61) ^ (n >>> 16);
  n = n + (n << 3);
  n = n ^ (n >>> 4);
  n = Math.imul(n, 0x27d4eb2d);
  n = n ^ (n >>> 15);
  return (n >>> 0) / 4294967296;
}

/** Agent look options, picked deterministically from spriteSeed. */
export const HAIR = ['#3b2a20', '#6b3f22', '#d9b36a', '#2b2b2b', '#a8452c', '#c49a6c', '#5a3b6b'];
export const SKIN = ['#f2cfa7', '#e3b48a', '#c98e63', '#9c6644', '#6e4730'];
export const SHIRT = ['#e76f51', '#4f9aa5', '#7fb069', '#d9a441', '#8a6fb8', '#e8b4b8', '#5d7fb8', '#c7d36f'];
export const PANTS = ['#34405a', '#4a3a57', '#3d4a3a', '#55321c'];
