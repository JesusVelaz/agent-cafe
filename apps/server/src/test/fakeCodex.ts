import { EventEmitter } from 'node:events';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import type { CodexChild, CodexSpawner } from '../providers/codexRpc.js';

type Msg = Record<string, unknown> & { id?: string | number; method?: string; params?: unknown };
type Handler = (params: any, srv: FakeCodexServer) => unknown | Promise<unknown>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** A JSON-RPC error a fake handler can throw. */
export class FakeRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

/** Speaks the app-server line protocol over in-memory pipes; tests script the replies. */
export class FakeCodexServer {
  readonly received: Msg[] = [];
  readonly spawns: Array<{ exe: string; args: string[] }> = [];
  private readonly handlers = new Map<string, Handler>();
  private readonly waiting = new Map<string | number, (m: Msg) => void>();
  private nextId = 1000;
  private child!: CodexChild & EventEmitter & { stdout: PassThrough; stderr: PassThrough };
  private exited = false;
  killed = false;

  constructor(opts: { version?: string; models?: Array<Record<string, unknown>>; account?: unknown; sandbox?: string } = {}) {
    this.on('initialize', () => ({
      userAgent: `agent_cafe/${opts.version ?? '0.154.0'} (Windows 10.0; x86_64) test`,
      codexHome: '/home/.codex',
      platformFamily: 'windows',
      platformOs: 'windows',
    }));
    this.on('account/read', () => ({ account: opts.account ?? { type: 'chatgpt', email: 'barista@example.com', planType: 'plus' }, requiresOpenaiAuth: true }));
    this.on('model/list', () => ({
      data: opts.models ?? [
        { id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: 'Flagship', hidden: false, isDefault: true },
        { id: 'gpt-5.6-luna', model: 'gpt-5.6-luna', displayName: 'GPT-5.6-Luna', description: 'Fast', hidden: false, isDefault: false },
      ],
      nextCursor: null,
    }));
    this.on('windowsSandbox/readiness', () => ({ status: opts.sandbox ?? 'ready' }));
    const thread = (p: Record<string, unknown>, id: string) => ({
      thread: { id },
      model: p.model ?? 'gpt-6-astra',
      cwd: p.cwd,
      approvalPolicy: p.approvalPolicy,
      approvalsReviewer: p.approvalsReviewer ?? 'user',
      // As 0.154 reports it: the cwd is writable implicitly, so no extra roots.
      sandbox:
        p.sandbox === 'workspace-write'
          ? { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
          : { type: 'dangerFullAccess' },
    });
    this.on('thread/start', (p) => thread(p, 'thr_new'));
    this.on('thread/resume', (p) => thread(p, p.threadId));
    this.on('turn/start', () => ({ turn: { id: 'turn_1', items: [], status: 'inProgress', error: null } }));
    this.on('turn/interrupt', (p) => {
      setImmediate(() => this.completeTurn('interrupted', null, p.threadId, p.turnId));
      return {};
    });
  }

  readonly spawn: CodexSpawner = (exe, args) => {
    this.spawns.push({ exe, args });
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: () => {
        this.killed = true;
        this.exit(null, 'SIGTERM');
      },
    });
    this.child = child;
    this.exited = false;
    child.stdin.on('finish', () => setImmediate(() => this.exit(0)));
    createInterface({ input: child.stdin }).on('line', (line) => this.onLine(line));
    return child;
  };

  /** Replace (or add) the reply to a client request. */
  on(method: string, handler: Handler): this {
    this.handlers.set(method, handler);
    return this;
  }

  notify(method: string, params: unknown): void {
    this.write({ method, params });
  }

  /** A server-initiated request (an approval); resolves with the client's reply. */
  request(method: string, params: unknown): Promise<Msg> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.write({ id, method, params });
    });
  }

  completeTurn(status: string, error: unknown = null, threadId = 'thr_new', turnId = 'turn_1'): void {
    this.notify('turn/completed', { threadId, turn: { id: turnId, items: [], status, error } });
  }

  writeRaw(line: string): void {
    this.child.stdout.write(`${line}\n`);
  }

  stderr(line: string): void {
    this.child.stderr.write(`${line}\n`);
  }

  exit(code: number | null, signal: string | null = null): void {
    if (this.exited) return;
    this.exited = true;
    setImmediate(() => this.child.emit('exit', code, signal));
  }

  requests(method: string): Msg[] {
    return this.received.filter((m) => m.method === method && m.id !== undefined);
  }

  private write(msg: Msg): void {
    if (!this.exited) this.child.stdout.write(`${JSON.stringify(msg)}\n`);
  }

  private async onLine(line: string): Promise<void> {
    const msg = JSON.parse(line) as Msg;
    this.received.push(msg);
    if (msg.method === undefined && msg.id !== undefined) {
      this.waiting.get(msg.id)?.(msg);
      this.waiting.delete(msg.id);
      return;
    }
    if (msg.id === undefined || !msg.method) return; // a notification (initialized)
    const handler = this.handlers.get(msg.method);
    if (!handler) return this.write({ id: msg.id, error: { code: -32600, message: `Invalid request: unknown variant \`${msg.method}\`` } });
    try {
      this.write({ id: msg.id, result: await handler(msg.params, this) });
    } catch (err) {
      const code = err instanceof FakeRpcError ? err.code : -32603;
      this.write({ id: msg.id, error: { code, message: (err as Error).message } });
    }
  }
}
