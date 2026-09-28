'use client';

import type { ProviderId } from '@agent-cafe/shared';
import { useEffect, useRef } from 'react';
import { drawAvatar } from '@/scene/avatar';

/** The agent's in-scene sprite (head and shoulders), scaled up crisply. */
export function Avatar({ seed, providerId, scale = 3 }: { seed: number; providerId: ProviderId; scale?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawAvatar(ref.current, seed, providerId);
  }, [seed, providerId]);
  return <canvas ref={ref} aria-hidden className="pixelated shrink-0" style={{ width: 14 * scale, height: 14 * scale }} />;
}
