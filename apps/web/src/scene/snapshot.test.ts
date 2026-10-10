/**
 * Visual snapshot helper: renders the real scene to a PNG for eyeballing.
 * Runs only when SNAP is set: `SNAP=out.png THEME=night npx vitest run snapshot`.
 * FRAME=WxH renders a bigger frame (the plot stays centred); T=seconds picks the moment;
 * SCALE=n sets the zoom; ANGLE=degrees turns the camera (90 = one quarter turn).
 */
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ThemeId } from './atmosphere';
import { renderScene, SCENE_H, SCENE_W } from './building';
import { cats, crew } from './fixtures';
import { Raster } from './raster';

/** CROP=x,y,w,h (scene px) cuts a region out before scaling up. */
function crop(R: Raster): Raster {
  const c = process.env.CROP?.split(',').map(Number);
  if (!c || c.length !== 4) return R;
  const [x0, y0, w, h] = c as [number, number, number, number];
  const out = new Raster(w, h);
  for (let y = 0; y < h; y++) out.d.set(R.d.subarray(((y0 + y) * R.w + x0) * 4, ((y0 + y) * R.w + x0 + w) * 4), y * w * 4);
  return out;
}

function png(R: Raster, scale: number): Buffer {
  R = crop(R);
  const W = R.w * scale, H = R.h * scale;
  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = (Math.floor(y / scale) * R.w + Math.floor(x / scale)) * 4;
      const di = y * (W * 4 + 1) + 1 + x * 4;
      raw[di] = R.d[si]!; raw[di + 1] = R.d[si + 1]!; raw[di + 2] = R.d[si + 2]!; raw[di + 3] = R.d[si + 3] || 255;
    }
  }
  const table = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const v of b) c = table[(c ^ v) & 255]! ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}


describe('scene snapshot', () => {
  it.skipIf(!process.env.SNAP)('renders the café', () => {
    const themes = (process.env.THEME ?? 'day').split(',') as ThemeId[];
    const [fw, fh] = (process.env.FRAME ?? `${SCENE_W}x${SCENE_H}`).split('x').map(Number) as [number, number];
    const R = new Raster(fw, fh);
    const frames = themes.map((theme) => {
      const angle = (Number(process.env.ANGLE ?? 0) * Math.PI) / 180;
      const hits = renderScene(R, crew, { theme, t: Number(process.env.T ?? 3), selectedId: 'earl', floors: { openai: { mode: 'mock', closed: false }, anthropic: { mode: 'live', closed: false } }, cats, angle });
      expect(hits.agents).toHaveLength(crew.length);
      return png(R, Number(process.env.SCALE ?? 2));
    });
    frames.forEach((buf, i) => writeFileSync(process.env.SNAP!.replace('.png', `-${themes[i]}.png`), buf));
  });
});

describe('character sheet', () => {
  it.skipIf(!process.env.SHEET)('renders every look', async () => {
    const { agentLook, agentSprite, AGENT_W, AGENT_H, MOODS } = await import('./sprites');
    const frames = ['stand', 'walkA', 'sit', 'typeB', 'sleep', 'backStand'] as const;
    const seeds = [11, 23, 37, 41, 53, 67, 5, 99];
    const cols = frames.length + MOODS.length;
    const R = new Raster((AGENT_W + 4) * cols, (AGENT_H + 4) * seeds.length);
    R.rect(0, 0, R.w, R.h, '#efe3cf');
    seeds.forEach((seed, i) => {
      const look = agentLook(seed, i % 2 ? 'office' : 'casual');
      const cells = [...frames.map((f) => agentSprite(f, look)), ...MOODS.map((m) => agentSprite('stand', look, m))];
      cells.forEach(({ grid, palette }, j) => R.grid(grid, palette, 2 + j * (AGENT_W + 4), 2 + i * (AGENT_H + 4)));
    });
    writeFileSync(process.env.SHEET!, png(R, 6));
  });
});

describe('cat sheet', () => {
  it.skipIf(!process.env.CATS)('renders every cat frame', async () => {
    const { CAT, CAT_FURS } = await import('./sprites');
    const frames = Object.keys(CAT) as Array<keyof typeof CAT>;
    const R = new Raster(16 * frames.length, 14 * CAT_FURS.length);
    R.rect(0, 0, R.w, R.h, '#efe3cf');
    CAT_FURS.forEach((pal, i) => frames.forEach((f, j) => R.grid(CAT[f], pal, 1 + j * 16, 2 + i * 14)));
    writeFileSync(process.env.CATS!, png(R, 8));
  });
});
