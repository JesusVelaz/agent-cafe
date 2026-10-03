import type { HarnessModelDTO } from '@agent-cafe/shared';

export interface ModelOptions {
  models: HarnessModelDTO[];
  loading: boolean;
  error: string | null;
}
export const EMPTY_MODELS: ModelOptions = { models: [], loading: true, error: null };

/** One account-keyed resource shared by the composer, settings, and task labels. */
export class ModelOptionsStore {
  private readonly entries = new Map<string, ModelOptions>();
  private readonly expires = new Map<string, number>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly listeners = new Map<string, Set<() => void>>();

  snapshot(key: string): ModelOptions {
    const expires = this.expires.get(key);
    return expires !== undefined && expires <= Date.now() ? EMPTY_MODELS : this.entries.get(key) ?? EMPTY_MODELS;
  }
  subscribe(key: string, listener: () => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    set.add(listener);
    this.listeners.set(key, set);
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(key); };
  }
  private publish(key: string, value: ModelOptions) {
    this.entries.set(key, value);
    for (const listener of this.listeners.get(key) ?? []) listener();
  }
  load(key: string, fetch: () => Promise<{ models: HarnessModelDTO[]; message?: string }>, refresh = false): Promise<void> {
    const running = this.pending.get(key);
    if (running) return running;
    if (!refresh && (this.expires.get(key) ?? 0) > Date.now()) return Promise.resolve();
    this.publish(key, EMPTY_MODELS);
    const request = Promise.resolve().then(fetch).then((reply) => {
      if (reply.models.length) this.expires.set(key, Date.now() + 60_000);
      else this.expires.delete(key);
      this.publish(key, { models: reply.models, loading: false, error: reply.models.length ? null : reply.message ?? 'No available models were reported.' });
    }).catch(() => {
      this.expires.delete(key);
      this.publish(key, { models: [], loading: false, error: 'Could not load available models. Refresh to try again.' });
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, request);
    return request;
  }
}
