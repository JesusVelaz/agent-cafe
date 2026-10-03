'use client';

import type { HarnessModelDTO, ProviderId } from '@agent-cafe/shared';
import { offeredModel } from '@agent-cafe/shared';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useCafe } from '@/store/cafe';
import { api } from './api';
import { EMPTY_MODELS, ModelOptionsStore } from './modelOptions';

const options = new ModelOptionsStore();

/**
 * Live options come only from the signed-in harness; Demo options come from its catalog.
 */
export function useModels(p: ProviderId): HarnessModelDTO[] {
  return useModelOptions(p).models;
}

export function useModelOptions(p: ProviderId) {
  const provider = useCafe((s) => s.providers[p]);
  const mode = provider?.mode;
  const c = provider?.connection;
  const key = JSON.stringify([p, mode, c?.state, c?.account, c?.plan, c?.version, c?.checkedAt]);
  const subscribe = useCallback((listener: () => void) => options.subscribe(key, listener), [key]);
  const snapshot = useCallback(() => options.snapshot(key), [key]);
  const current = useSyncExternalStore(subscribe, snapshot, () => EMPTY_MODELS);
  const load = useCallback((refresh = false) => options.load(key, async () => {
    if (!mode) return { models: [], message: 'Loading provider settings…' };
    if (mode === 'off') return { models: [], message: 'This floor is switched off.' };
    const reply = await api.models(p, refresh);
    const expected = mode === 'mock' ? 'catalog' : 'harness';
    return reply.source === expected ? reply : { models: [], message: reply.message ?? 'Models could not be verified. Refresh to try again.' };
  }, refresh), [key, mode, p]);
  useEffect(() => {
    void load();
    const interval = setInterval(() => { void load(true); }, 60_000);
    return () => clearInterval(interval);
  }, [load]);
  return { ...current, refresh: () => { void load(true); } };
}

/** "claude-opus-5-5" → "Opus 5.5" when known; the raw id otherwise. */
export function modelLabel(models: HarnessModelDTO[], value: string): string {
  return offeredModel(models, value)?.label ?? value.replace(/^claude-/, '');
}
