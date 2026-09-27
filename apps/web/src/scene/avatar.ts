/** Draws an agent's head and shoulders into a <canvas>, for UI avatars that match the scene. */
import { accessorize, AGENT, agentLook, withApron } from './sprites';

export function drawAvatar(canvas: HTMLCanvasElement, seed: number, demo: boolean) {
  const look = agentLook(seed);
  let grid = accessorize(AGENT.stand, look.accessory, 'stand');
  if (demo) grid = withApron(grid, 'stand');
  grid = grid.slice(0, 14);
  canvas.width = 12;
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
