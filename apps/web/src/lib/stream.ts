import type { CafeEvent } from '@agent-cafe/shared';
import { API_URL } from './api';

export type ConnectionState = 'connecting' | 'open' | 'down';

/**
 * Subscribes to the server's SSE stream. EventSource reconnects on its own (the
 * server sends `retry: 2000`); every reconnect starts with a fresh snapshot, so
 * no client-side gap-filling is needed.
 */
export function connectStream(onEvent: (e: CafeEvent) => void, onState: (s: ConnectionState) => void): () => void {
  onState('connecting');
  const es = new EventSource(`${API_URL}/api/stream`);
  es.onopen = () => onState('open');
  es.onerror = () => onState(es.readyState === EventSource.CLOSED ? 'down' : 'connecting');
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as CafeEvent);
    } catch (err) {
      console.error('Bad stream message', err);
    }
  };
  return () => es.close();
}
