/** Draws an agent's front sprite into a <canvas>, for UI avatars that match the scene. */
import { C, shade } from './palette';
import { agentLook } from './registry';
import { AGENT_FRONT, withApron } from './sprites';

export function drawAvatar(canvas: HTMLCanvasElement, seed: number, demo: boolean) {
  const look = agentLook(seed);
  const pal: Record<string, string> = {
    o: C.ink,
    e: C.ink,
    b: '#3a2a22',
    a: C.cream,
    A: C.creamShade,
    h: look.hair,
    H: shade(look.hair, -0.25),
    s: look.skin,
    S: shade(look.skin, -0.18),
    c: look.shirt,
    C: shade(look.shirt, -0.22),
    p: look.pants,
  };
  // Head and torso only: a bust reads better at avatar size.
  const grid = (demo ? withApron(AGENT_FRONT.stand, false) : AGENT_FRONT.stand).slice(0, 14);
  canvas.width = 12;
  canvas.height = grid.length;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]!];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}
