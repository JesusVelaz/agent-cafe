/**
 * JSON-RPC over a `codex app-server` child's stdio: one JSON message per line,
 * "jsonrpc" omitted on the wire (https://learn.chatgpt.com/docs/app-server).
 *
 * Transport only: request ids and timeouts, server-initiated requests (approvals),
 * notifications, malformed lines and process exit. It knows nothing about tasks.
 * Message shapes are checked by the caller at runtime; nothing here trusts types.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { harnessEnv } from './live.js';

export type RequestId = string | number;

/** The child's streams and lifecycle; a real process or a test double. */
export interface CodexChild {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill(): void;
  once(event: 'exit', fn: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', fn: (err: Error) => void): unknown;
}

export type CodexSpawner = (exe: string, args: string[]) => CodexChild;

/** Starts the CLI without a shell, except for Windows .cmd/.bat shims (which need one). */
export const spawnCodex: CodexSpawner = (exe, args) => {
  const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(exe);
  // The arguments are fixed by Agents Café (never user text), so shell mode can't be injected into.
  const child: ChildProcessWithoutNullStreams = shim
    ? spawn(`"${exe}"`, args, { shell: true, windowsHide: true, env: harnessEnv() })
    : spawn(exe, args, { windowsHide: true, env: harnessEnv() });
  return child;
};

export type RpcErrorKind = 'rpc' | 'timeout' | 'exited' | 'unsupported';

export class CodexRpcError extends Error {
  constructor(
    message: string,
    readonly kind: RpcErrorKind,
    readonly method: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'CodexRpcError';
  }
}

/** A handler's way to answer a server request with a JSON-RPC error. */
export class RpcReplyError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

export interface CodexExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** Last few stderr lines, for error messages. */
  stderr: string;
  /** Set when the process couldn't be started at all. */
  spawnError?: string;
}

export interface CodexRpcHandlers {
  onNotification?: (method: string, params: unknown) => void;
  /** Answer a server-initiated request. Throw RpcReplyError to reply with an error. */
  onRequest?: (method: string, params: unknown, id: RequestId) => Promise<unknown>;
  /** A line that isn't a JSON-RPC message. */
  onMalformed?: (line: string) => void;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is RequestId => typeof x === 'string' || typeof x === 'number';
const STDERR_LINES = 20;

export class CodexRpc {
  private nextId = 1;
  private readonly pending = new Map<RequestId, { method: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private readonly stderrTail: string[] = [];
  private exitInfo: CodexExit | null = null;
  /** Resolves once the process is gone (exit or failed spawn). Never rejects. */
  readonly exited: Promise<CodexExit>;

  constructor(
    private readonly child: CodexChild,
    private readonly handlers: CodexRpcHandlers = {},
    private readonly defaultTimeoutMs = 30_000,
  ) {
    let markExit!: (e: CodexExit) => void;
    this.exited = new Promise((r) => (markExit = r));
    const finish = (e: Omit<CodexExit, 'stderr'>) => {
      if (this.exitInfo) return;
      this.exitInfo = { ...e, stderr: this.stderrTail.join('\n') };
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new CodexRpcError(exitMessage(this.exitInfo), 'exited', p.method));
      }
      this.pending.clear();
      markExit(this.exitInfo);
    };
    child.once('exit', (code, signal) => finish({ code, signal }));
    child.once('error', (err) => finish({ code: null, signal: null, spawnError: err.message }));
    // A closed pipe surfaces as an exit; don't let a write error crash the server.
    child.stdin.on('error', () => {});

    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (!line.trim()) return;
      this.stderrTail.push(line.slice(0, 500));
      if (this.stderrTail.length > STDERR_LINES) this.stderrTail.shift();
    });
  }

  get isAlive(): boolean {
    return this.exitInfo === null;
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = this.defaultTimeoutMs): Promise<T> {
    if (this.exitInfo) return Promise.reject(new CodexRpcError(exitMessage(this.exitInfo), 'exited', method));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CodexRpcError(`Codex didn't answer ${method} within ${Math.round(timeoutMs / 1000)}s.`, 'timeout', method));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  /** Closes stdin (app-server exits on EOF), then kills it if it lingers. */
  async close(graceMs = 2000): Promise<CodexExit> {
    if (!this.exitInfo) {
      this.child.stdin.end();
      const t = setTimeout(() => this.child.kill(), graceMs);
      t.unref?.();
      await this.exited;
      clearTimeout(t);
    }
    return this.exited;
  }

  private write(msg: Record<string, unknown>): void {
    if (this.exitInfo) return;
    this.child.stdin.write(`${JSON.stringify(msg)}\n`);
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      this.handlers.onMalformed?.(line);
      return;
    }
    if (!isObject(msg)) return this.handlers.onMalformed?.(line);
    const { id, method } = msg;
    if (typeof method === 'string' && isId(id)) return void this.answer(id, method, msg.params);
    if (typeof method === 'string') return this.handlers.onNotification?.(method, msg.params);
    if (isId(id) && ('result' in msg || 'error' in msg)) {
      const p = this.pending.get(id);
      if (!p) return; // late reply to a request that already timed out
      this.pending.delete(id);
      clearTimeout(p.timer);
      if ('error' in msg) {
        const err = isObject(msg.error) ? msg.error : {};
        const message = typeof err.message === 'string' ? err.message : `Codex rejected ${p.method}.`;
        const code = typeof err.code === 'number' ? err.code : undefined;
        // 0.154 answers an unknown method with -32600 "unknown variant"; the spec's code is -32601.
        const unsupported = code === -32601 || /unknown variant/i.test(message);
        p.reject(new CodexRpcError(message, unsupported ? 'unsupported' : 'rpc', p.method, code));
      } else p.resolve(msg.result);
      return;
    }
    this.handlers.onMalformed?.(line);
  }

  private async answer(id: RequestId, method: string, params: unknown): Promise<void> {
    if (!this.handlers.onRequest) return this.write({ id, error: { code: -32601, message: `Unsupported request: ${method}` } });
    try {
      const result = await this.handlers.onRequest(method, params, id);
      this.write({ id, result });
    } catch (err) {
      const code = err instanceof RpcReplyError ? err.code : -32603;
      this.write({ id, error: { code, message: err instanceof Error ? err.message : String(err) } });
    }
  }
}

export function exitMessage(e: CodexExit): string {
  if (e.spawnError) return `Couldn't start Codex: ${e.spawnError}`;
  const how = e.signal ? `was stopped (${e.signal})` : `exited with code ${e.code}`;
  const tail = e.stderr.split('\n').filter(Boolean).slice(-3).join(' · ');
  return `Codex ${how}${tail ? `: ${tail}` : '.'}`;
}
