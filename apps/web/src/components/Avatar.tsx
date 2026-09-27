'use client';

import { useEffect, useRef } from 'react';
import { drawAvatar } from '@/scene/avatar';

/** The agent's in-scene sprite (head and shoulders), scaled up crisply. */
export function Avatar({ seed, demo, scale = 3 }: { seed: number; demo: boolean; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawAvatar(ref.current, seed, demo);
  }, [seed, demo]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pixelated shrink-0"
      style={{ width: 12 * scale, height: 14 * scale }}
    />
  );
}
