/** Draws an agent's head and shoulders into a <canvas>, for UI avatars that match the scene. */
import type { ProviderId } from '@agent-cafe/shared';
import { agentGrid, agentLook } from './sprites';

export const outfitFor = (providerId: ProviderId) => (providerId === 'openai' ? 'barista' : 'office');

export function drawAvatar(canvas: HTMLCanvasElement, seed: number, providerId: ProviderId) {
  const look = agentLook(seed, outfitFor(providerId));
  const grid = agentGrid('stand', look).slice(0, 14);
  canvas.width = grid[0]!.length;
  canvas.height = grid.length;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = look.palette[row[x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}
