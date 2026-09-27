/**
 * The café's colours. Warm cream/walnut interior against teal walls, a navy
 * checker floor downstairs and floorboards in the loft. UI chrome tokens in
 * globals.css are derived from the same values.
 */
export const C = {
  bg: '#1c2729',
  bgGrid: '#223033',

  cream: '#efe4c8',
  creamShade: '#d9cba8',
  navy: '#34405a',
  navyShade: '#2b3549',

  wall: '#cdb391',
  wallShade: '#b99d7a',
  wainscot: '#4f9aa5',
  wainscotShade: '#3f7f89',
  trim: '#2c5f67',
  loftWall: '#8fb3ad',
  loftWainscot: '#5c7f7a',
  wallCap: '#6d5a47',

  plank: '#b07a4a',
  plankLight: '#c08a57',
  plankDark: '#946238',

  walnut: '#7a4a2a',
  walnutLight: '#9a6438',
  walnutDark: '#55321c',
  countertop: '#c9a06a',
  marble: '#e9e2d4',

  metal: '#b8c0c8',
  metalDark: '#6c7680',
  ink: '#2a2320',
  screen: '#9ee7e3',
  screenDim: '#4b8f96',

  glass: '#a9dce0',
  glassDark: '#79b7c0',
  chalkboard: '#27352f',
  chalk: '#e9e4d6',
  cork: '#c08b58',

  leaf: '#5b9a4a',
  leafDark: '#3f7a3a',
  pot: '#b0643a',

  brass: '#d9a441',
  mint: '#7fd4a0',
  amber: '#e9c46a',
  coral: '#e76f51',
  white: '#fbf7ee',
  red: '#d9544d',
  shadow: '#00000040',
} as const;

function clamp(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')}`;
}

/** amount > 0 lightens toward white, < 0 darkens toward black. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = amount < 0 ? 0 : 255;
  const a = Math.abs(amount);
  return rgbToHex(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a);
}

/** Agent look options; picked deterministically from spriteSeed. */
export const HAIR = ['#3b2a20', '#6b3f22', '#d9b36a', '#2b2b2b', '#a8452c', '#e8e0d0', '#5a3b6b'];
export const SKIN = ['#f2cfa7', '#e3b48a', '#c98e63', '#9c6644', '#6e4730'];
export const SHIRT = ['#e76f51', '#4f9aa5', '#7fd4a0', '#d9a441', '#8a6fb8', '#e8b4b8', '#5d7fb8', '#c7d36f'];
export const PANTS = ['#34405a', '#4a3a57', '#3d4a3a', '#55321c'];
