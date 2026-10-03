import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_MODELS, ModelOptionsStore } from './modelOptions';

const model = (value: string) => ({ value, label: value, description: '' });
afterEach(() => { vi.useRealTimers(); });

describe('account model options', () => {
  it('starts empty and does not reuse options across provider mode or account changes', async () => {
    const store = new ModelOptionsStore();
    expect(store.snapshot('live:account-a')).toBe(EMPTY_MODELS);
    await store.load('demo', async () => ({ models: [model('demo-only')] }));
    expect(store.snapshot('live:account-a').models).toEqual([]);
    await store.load('live:account-a', async () => ({ models: [model('account-a-only')] }));
    expect(store.snapshot('live:account-b').models).toEqual([]);
  });

  it('removes old options during refresh and retains none when discovery fails', async () => {
    const store = new ModelOptionsStore();
    await store.load('live', async () => ({ models: [model('old')] }));
    const failed = store.load('live', async () => { throw new Error('Disconnected'); }, true);
    expect(store.snapshot('live').models).toEqual([]);
    await failed;
    expect(store.snapshot('live')).toMatchObject({ models: [], loading: false, error: expect.any(String) });
    await store.load('live', async () => ({ models: [model('new')] }));
    expect(store.snapshot('live').models).toEqual([model('new')]);
  });

  it('does not serve expired options and shares discovery across subscribers', async () => {
    vi.useFakeTimers();
    const store = new ModelOptionsStore();
    const fetch = vi.fn(async () => ({ models: [model('current')] }));
    await Promise.all([store.load('live', fetch), store.load('live', fetch)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_001);
    expect(store.snapshot('live').models).toEqual([]);
    await store.load('live', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(store.snapshot('live').models).toEqual([model('current')]);
  });

  it('keeps a discovery error separate from search with no matches', async () => {
    const store = new ModelOptionsStore();
    await store.load('live', async () => ({ models: [], message: 'Connect Claude to choose a model.' }));
    expect(store.snapshot('live')).toEqual({ models: [], loading: false, error: 'Connect Claude to choose a model.' });
  });
});
