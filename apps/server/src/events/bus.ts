import type { CafeEvent } from '@agent-cafe/shared';

type Listener = (event: CafeEvent) => void;

/**
 * In-process pub/sub between the orchestrator and SSE clients.
 * Swap for Redis or similar if the orchestrator ever runs out-of-process.
 */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  publish(event: CafeEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(event);
      } catch (err) {
        console.error('[bus] listener failed', err);
      }
    }
  }
}
