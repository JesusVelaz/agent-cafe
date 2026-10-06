import { describe, expect, it } from 'vitest';
import { fitFrame, plotOffset, SCENE_H, SCENE_W } from './frame';

/** Where the plot's centre lands on screen (CSS px from the stage's left/top) once the frame is centred in it. */
function plotCentre(width: number, height: number) {
  const f = fitFrame(width, height);
  const left = (width - f.w * f.scale) / 2, top = (height - f.h * f.scale) / 2;
  const off = plotOffset(f);
  return { x: left + (off.x + SCENE_W / 2) * f.scale, y: top + (off.y + SCENE_H / 2) * f.scale };
}

describe('fitFrame', () => {
  it('never draws less than the base frame', () => {
    const f = fitFrame(300, 200);
    expect(f.w).toBeGreaterThanOrEqual(SCENE_W);
    expect(f.h).toBeGreaterThanOrEqual(SCENE_H);
  });

  it('keeps the café dead centre while the stage is resized pixel by pixel', () => {
    // The panel animates the stage's width; the café mustn't wobble as it does.
    for (let width = 900; width <= 1400; width++) expect(plotCentre(width, 844).x).toBeCloseTo(width / 2, 6);
    for (let height = 820; height <= 900; height++) expect(plotCentre(1200, height).y).toBeCloseTo(height / 2, 6);
  });
});
