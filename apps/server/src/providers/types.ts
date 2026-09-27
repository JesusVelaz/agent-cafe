/**
 * Provider-neutral model interface. The runner's tool loop talks only to this;
 * each vendor adapter translates to and from its own SDK format.
 *
 * Adding a provider: implement ProviderAdapter, add its id to PROVIDER_IDS (shared),
 * register it in registry.ts, and add models to the shared catalog.
 */
import type { ToolName } from '@agent-cafe/shared';
import type { ToolSpec } from '../tools/registry.js';

export interface ToolCall {
  id: string;
  name: ToolName;
  input: Record<string, unknown>;
}

export interface ToolResultMessage {
  callId: string;
  name: ToolName;
  output: string;
  isError: boolean;
}

export type NeutralMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      text: string;
      toolCalls: ToolCall[];
      /**
       * Provider-native content (e.g. Anthropic thinking blocks) that must be replayed
       * verbatim on the next turn. Opaque to everything except the adapter that made it.
       */
      raw?: unknown;
    }
  | { role: 'tool'; results: ToolResultMessage[] };

export interface TurnRequest {
  model: string;
  system: string;
  messages: NeutralMessage[];
  tools: ToolSpec[];
  maxOutputTokens: number;
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
  stop: 'end' | 'tool_use' | 'max_tokens' | 'refusal';
  raw?: unknown;
}

export interface ProviderAdapter {
  readonly kind: 'live' | 'mock';
  /** One model turn. Streams text through onDelta; must reject with an AbortError on abort. */
  runTurn(req: TurnRequest, signal: AbortSignal, onDelta: (text: string) => void): Promise<TurnResult>;
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

/** A provider-side failure (HTTP error, rate limit, simulated jam…). */
export class AdapterError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'AdapterError';
  }
}

export function abortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

export const isAbortError = (err: unknown): boolean => err instanceof Error && err.name === 'AbortError';

/** setTimeout as a promise that rejects with AbortError when the signal fires. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
