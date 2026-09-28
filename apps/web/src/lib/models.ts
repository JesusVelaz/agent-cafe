'use client';

import type { HarnessModelDTO, ProviderId } from '@agent-cafe/shared';
import { modelsFor } from '@agent-cafe/shared';
import { useEffect, useState } from 'react';
import { useCafe } from '@/store/cafe';
import { api } from './api';

const cache = new Map<string, HarnessModelDTO[]>();

const fallback = (p: ProviderId): HarnessModelDTO[] =>
  modelsFor(p).map((m) => ({ value: m.id, label: m.label.replace(/^Claude /, ''), description: m.tier }));

/**
 * Every model a floor's harness offers (refetched when its sign-in state changes),
 * with the demo catalog as an immediate fallback.
 */
export function useModels(p: ProviderId): HarnessModelDTO[] {
  const state = useCafe((s) => s.providers[p]?.connection.state ?? 'checking');
  const key = `${p}:${state}`;
  const [models, setModels] = useState<HarnessModelDTO[]>(() => cache.get(key) ?? fallback(p));
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) return setModels(hit);
    let cancelled = false;
    api
      .models(p)
      .then((r) => {
        cache.set(key, r.models);
        if (!cancelled) setModels(r.models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key, p]);
  return models;
}

/** "claude-opus-5-5" → "Opus 5.5" when known; the raw id otherwise. */
export function modelLabel(models: HarnessModelDTO[], value: string): string {
  return models.find((m) => m.value === value)?.label ?? value.replace(/^claude-/, '');
}
