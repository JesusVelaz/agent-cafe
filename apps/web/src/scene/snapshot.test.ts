/**
 * Visual snapshot helper: renders the real scene to a PNG for eyeballing.
 * Runs only when SNAP is set: `SNAP=out.png THEME=night npx vitest run snapshot`.
 */
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { FLOORS } from '@/sim/layout';
import type { ThemeId } from './atmosphere';
import { renderScene, SCENE_H, SCENE_W, type SceneAgent } from './building';
import { Raster } from './raster';

function png(R: Raster, scale: number): Buffer {
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

const G = FLOORS.openai, U = FLOORS.anthropic;
const crew: SceneAgent[] = [
  { id: 'mocha', name: 'Mocha', providerId: 'openai', ...G.seats[0]!, pose: 'type', t: 1, bubble: { kind: 'think' }, spriteSeed: 11, demo: true },
  { id: 'chai', name: 'Chai', providerId: 'openai', ...G.stations.bookcase[0]!, pose: 'work', t: 1, bubble: { kind: 'tool', tool: 'read_file' }, spriteSeed: 23, demo: true },
  { id: 'biscotti', name: 'Biscotti', providerId: 'openai', ...G.stations.register[0]!, pose: 'work', t: 1, bubble: { kind: 'fail' }, spriteSeed: 37, demo: false },
  { id: 'earl', name: 'Earl', providerId: 'anthropic', ...U.seats[0]!, pose: 'type', t: 1, bubble: { kind: 'think' }, spriteSeed: 41, demo: false },
  { id: 'matcha', name: 'Matcha', providerId: 'anthropic', ...U.seats[1]!, pose: 'sit', t: 1, bubble: { kind: 'done' }, spriteSeed: 53, demo: false },
  { id: 'scone', name: 'Scone', providerId: 'anthropic', ...U.stations.archive[0]!, pose: 'work', t: 1, bubble: { kind: 'zzz' }, spriteSeed: 67, demo: false },
];

describe('scene snapshot', () => {
  it.skipIf(!process.env.SNAP)('renders the café', () => {
    const themes = (process.env.THEME ?? 'day').split(',') as ThemeId[];
    const R = new Raster(SCENE_W, SCENE_H);
    const frames = themes.map((theme) => {
      const hits = renderScene(R, crew, { theme, t: 3, selectedId: 'earl', floors: { openai: { mode: 'mock', closed: false }, anthropic: { mode: 'live', closed: false } } });
      expect(hits).toHaveLength(crew.length);
      return png(R, 2);
    });
    frames.forEach((buf, i) => writeFileSync(process.env.SNAP!.replace('.png', `-${themes[i]}.png`), buf));
  });
});

describe('character sheet', () => {
  it.skipIf(!process.env.SHEET)('renders every look', async () => {
    const { agentGrid, agentLook, AGENT_W, AGENT_H } = await import('./sprites');
    const frames = ['stand', 'walkA', 'sit', 'typeB', 'sleep', 'backStand'] as const;
    const seeds = [11, 23, 37, 41, 53, 67, 5, 99];
    const R = new Raster((AGENT_W + 4) * frames.length * 2, (AGENT_H + 4) * seeds.length / 2);
    R.rect(0, 0, R.w, R.h, '#efe3cf');
    seeds.forEach((seed, i) => {
      const outfit = i % 2 ? 'office' : 'barista';
      const look = agentLook(seed, outfit);
      frames.forEach((f, j) => {
        const col = (i % 2) * frames.length + j, row = Math.floor(i / 2);
        R.grid(agentGrid(f, look), look.palette, 2 + col * (AGENT_W + 4), 2 + row * (AGENT_H + 4));
      });
    });
    writeFileSync(process.env.SHEET!, png(R, 6));
  });
});
