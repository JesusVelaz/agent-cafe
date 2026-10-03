/**
 * Harness connections: is each floor's vendor agent installed and signed in, and
 * which models does it offer? Agent Café never handles credentials: it asks the
 * installed CLI for its status, and "Connect" opens the vendor's own sign-in in a
 * terminal window, which completes entirely between the CLI and the vendor.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  HARNESS,
  type HarnessConnectionDTO,
  type HarnessModelDTO,
  type PlanUsageDTO,
  type ProviderId,
} from '@agent-cafe/shared';
import { claudePlanUsage, claudeSessionOptions } from './claude.js';
import { CODEX_MIN_VERSION, codexModels, codexPlanUsage, tooOldMessage, versionAtLeast } from './codex.js';
import { harnessEnv } from './live.js';

const run = promisify(execFile);

export interface HarnessProbe {
  /** Connection state plus the resolved executable path when installed. */
  check(): Promise<HarnessConnectionDTO & { executable: string | null }>;
  models(executable: string): Promise<HarnessModelDTO[]>;
  /** The plan's usage window, when the harness can report it outside a run. */
  usage?(executable: string): Promise<PlanUsageDTO | null>;
  /** CLI arguments that sign in (interactive, run in a terminal) and sign out. */
  loginArgs: string[];
  logoutArgs: string[];
}

/** Opens a terminal window running `exe args…` for the user to finish in. */
export type TerminalOpener = (title: string, exe: string, args: string[]) => Promise<void>;

const conn = (state: HarnessConnectionDTO['state'], extra: Partial<HarnessConnectionDTO> = {}): HarnessConnectionDTO => ({
  state, version: null, account: null, plan: null, message: null, checkedAt: new Date().toISOString(), ...extra,
});

export { harnessEnv };

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 5000 });
    const hits = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    // On Windows prefer the real binary: .cmd shims can't be run without a shell.
    return (process.platform === 'win32' ? hits.find((h) => /\.exe$/i.test(h)) : undefined) ?? hits[0] ?? null;
  } catch {
    return null;
  }
}

/** Runs a status command; many CLIs exit non-zero when signed out but still print their answer. */
async function output(exe: string, args: string[]): Promise<string> {
  try {
    const r = await run(exe, args, { timeout: 15_000, env: harnessEnv() });
    return `${r.stdout}\n${r.stderr}`;
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: unknown };
    if (e.stdout || e.stderr) return `${e.stdout ?? ''}\n${e.stderr ?? ''}`;
    throw err;
  }
}

const quoteSh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The default opener: a real terminal window, so any prompt the sign-in shows works as usual. */
export const openTerminal: TerminalOpener = (title, exe, args) =>
  new Promise((resolve, reject) => {
    let child;
    if (process.platform === 'win32') {
      // start "<title>" cmd /k ""C:\path\exe" args"  (cmd strips the outer quotes)
      const line = `start "${title}" cmd /k ""${exe}" ${args.join(' ')}"`;
      child = spawn('cmd.exe', ['/d', '/s', '/c', line], { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      const cmd = [exe, ...args].map(quoteSh).join(' ');
      child = spawn('osascript', ['-e', `tell application "Terminal" to do script "${cmd.replace(/"/g, '\\"')}"`, '-e', 'tell application "Terminal" to activate'], {
        detached: true,
        stdio: 'ignore',
      });
    } else {
      child = spawn('x-terminal-emulator', ['-T', title, '-e', exe, ...args], { detached: true, stdio: 'ignore' });
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });

export const claudeCodeProbe: HarnessProbe = {
  loginArgs: ['auth', 'login', '--claudeai'],
  logoutArgs: ['auth', 'logout'],
  async check() {
    const executable = await which('claude');
    if (!executable) {
      return { ...conn('not_installed', { message: 'Install Claude Code, then run `claude auth login`.' }), executable: null };
    }
    try {
      const env = harnessEnv();
      const [version, status] = await Promise.all([
        run(executable, ['--version'], { timeout: 15_000, env }).then((r) => r.stdout.trim().split(/\s/)[0] ?? null),
        // Exits non-zero when signed out, but still prints its JSON status.
        run(executable, ['auth', 'status'], { timeout: 15_000, env })
          .then((r) => r.stdout, (err: { stdout?: string }) => {
            if (err.stdout?.trim().startsWith('{')) return err.stdout;
            throw err;
          })
          .then((out) => JSON.parse(out) as Record<string, unknown>),
      ]);
      const str = (k: string) => (typeof status[k] === 'string' ? (status[k] as string) : null);
      if (status.loggedIn !== true) {
        return { ...conn('signed_out', { version, message: 'Run `claude auth login` in a terminal, then check again.' }), executable };
      }
      return {
        ...conn('ready', { version, account: str('email'), plan: str('subscriptionType') ?? str('authMethod') }),
        executable,
      };
    } catch (err) {
      return { ...conn('error', { message: `Couldn't ask Claude Code: ${(err as Error).message}` }), executable };
    }
  },

  /** Starts a session that never sends a prompt, reads the model list, and closes it. */
  async models(executable) {
    let hold!: () => void;
    const idle = new Promise<void>((r) => (hold = r));
    async function* noPrompt() {
      await idle;
    }
    const q = query({ prompt: noPrompt(), options: { ...claudeSessionOptions(executable), persistSession: false } });
    try {
      const models = await q.supportedModels();
      return models.map((m) => ({
        value: m.value,
        label: m.displayName,
        description: m.description,
        ...(m.resolvedModel ? { resolved: m.resolvedModel } : {}),
      }));
    } finally {
      hold();
      q.close();
    }
  },

  /** The plan's 5-hour window, from the data behind /usage (see claude.ts). */
  usage: (executable) => claudePlanUsage(executable),
};

/** Codex, signed in with ChatGPT (`codex login`). Tasks run on its app-server (see codex.ts). */
export const codexProbe: HarnessProbe = {
  loginArgs: ['login'],
  logoutArgs: ['logout'],
  async check() {
    const executable = await which('codex');
    if (!executable) return { ...conn('not_installed', { message: 'Install Codex, then connect your ChatGPT account.' }), executable: null };
    try {
      const [version, status] = await Promise.all([
        output(executable, ['--version']).then((o) => o.trim().split(/\s+/).find((w) => /^\d+\.\d+/.test(w)) ?? null),
        output(executable, ['login', 'status']),
      ]);
      if (/not logged in|logged out/i.test(status) || !/logged in/i.test(status)) {
        return { ...conn('signed_out', { version, message: 'Connect your ChatGPT account (`codex login`).' }), executable };
      }
      // Signed in, but too old for the app-server protocol tasks run on.
      if (version && !versionAtLeast(version, CODEX_MIN_VERSION)) {
        return { ...conn('unsupported', { version, message: tooOldMessage(version) }), executable };
      }
      const via = status.match(/logged in using ([^\r\n.]+)/i)?.[1]?.trim() ?? null;
      return { ...conn('ready', { version, plan: via }), executable };
    } catch (err) {
      return { ...conn('error', { message: `Couldn't ask Codex: ${(err as Error).message}` }), executable };
    }
  },
  models: (executable) => codexModels(executable),
  usage: (executable) => codexPlanUsage(executable),
};

export class HarnessService {
  private readonly probes: Record<ProviderId, HarnessProbe>;
  private readonly state = new Map<ProviderId, HarnessConnectionDTO & { executable: string | null }>();
  private readonly usage = new Map<ProviderId, PlanUsageDTO>();
  private readonly modelCache = new Map<ProviderId, { models: HarnessModelDTO[]; expiresAt: number }>();
  private readonly modelInflight = new Map<ProviderId, Promise<HarnessModelDTO[]>>();
  private readonly modelGeneration = new Map<ProviderId, number>();
  private readonly inflight = new Map<ProviderId, Promise<HarnessConnectionDTO>>();
  private readonly watchers = new Map<ProviderId, ReturnType<typeof setInterval>>();
  private readonly listeners = new Set<(id: ProviderId) => void>();

  constructor(
    probes: Partial<Record<ProviderId, HarnessProbe>> = {},
    private readonly opener: TerminalOpener = openTerminal,
    private readonly watch = { everyMs: 3000, forMs: 10 * 60_000 },
  ) {
    this.probes = { anthropic: claudeCodeProbe, openai: codexProbe, ...probes };
  }

  /** Called whenever a check finds a different connection (signed in, signed out…). */
  onChange(fn: (id: ProviderId) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /**
   * Opens the vendor's sign-in in a terminal window, then keeps checking in the
   * background until it's connected (or the watch times out), so the UI updates
   * by itself however long the sign-in takes. Already signed in: nothing to open.
   */
  async connect(id: ProviderId): Promise<HarnessConnectionDTO> {
    const c = await this.check(id);
    if (c.state === 'ready') return c;
    // Signed in but too old: signing in again won't help.
    if (c.state === 'unsupported') throw new Error(c.message ?? `${HARNESS[id].name} needs an update.`);
    const exe = this.executable(id);
    if (!exe) throw new Error(c.message ?? `${HARNESS[id].name} isn't installed.`);
    await this.opener(`Connect ${HARNESS[id].account}`, exe, this.probes[id].loginArgs);
    this.watchSignIn(id);
    return c;
  }

  private watchSignIn(id: ProviderId) {
    clearInterval(this.watchers.get(id));
    const started = Date.now();
    const t = setInterval(() => {
      void this.check(id).then((c) => {
        if (c.state === 'ready' || Date.now() - started > this.watch.forMs) this.stopWatching(id);
      });
    }, this.watch.everyMs);
    t.unref?.();
    this.watchers.set(id, t);
  }

  private stopWatching(id: ProviderId) {
    clearInterval(this.watchers.get(id));
    this.watchers.delete(id);
  }

  /** Stops background sign-in watches (server shutdown, tests). */
  close() {
    for (const id of [...this.watchers.keys()]) this.stopWatching(id);
  }

  /** Signs the CLI out (for every use of it on this computer, not just Agent Café). */
  async disconnect(id: ProviderId): Promise<HarnessConnectionDTO> {
    await this.ensure(id);
    const exe = this.executable(id);
    if (exe) await output(exe, this.probes[id].logoutArgs).catch(() => '');
    return this.check(id);
  }

  connection(id: ProviderId): HarnessConnectionDTO {
    const s = this.state.get(id);
    if (!s) return conn('checking');
    const { executable: _, ...dto } = s;
    return dto;
  }

  executable(id: ProviderId): string | null {
    return this.state.get(id)?.executable ?? null;
  }

  /** Re-checks the harness. Concurrent callers share one check. */
  check(id: ProviderId): Promise<HarnessConnectionDTO> {
    const running = this.inflight.get(id);
    if (running) return running;
    const p = this.probes[id]
      .check()
      .then(async (s) => {
        // Harnesses that can report plan limits outside a run refresh them on every check.
        if (s.state === 'ready' && s.executable) await this.readUsage(id, s.executable);
        return s;
      })
      .then((s) => {
        const before = this.state.get(id);
        this.state.set(id, s);
        // A check can reflect a changed account, plan, CLI, or model entitlement.
        this.modelCache.delete(id);
        this.modelInflight.delete(id);
        this.modelGeneration.set(id, (this.modelGeneration.get(id) ?? 0) + 1);
        const changed = !before || before.state !== s.state || before.account !== s.account || before.plan !== s.plan;
        if (changed) for (const fn of this.listeners) fn(id);
        return this.connection(id);
      })
      .finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  /** The current connection, checking first if it was never checked. */
  async ensure(id: ProviderId): Promise<HarnessConnectionDTO> {
    return this.state.has(id) ? this.connection(id) : this.check(id);
  }

  async models(id: ProviderId, refresh = false): Promise<HarnessModelDTO[]> {
    const c = refresh ? await this.check(id) : await this.ensure(id);
    const exe = this.executable(id);
    if (c.state !== 'ready' || !exe) return [];
    const cached = this.modelCache.get(id);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.models;
    const pending = this.modelInflight.get(id);
    if (pending) return pending;
    const generation = this.modelGeneration.get(id) ?? 0;
    const request = this.probes[id].models(exe).then((models) => {
      if ((this.modelGeneration.get(id) ?? 0) !== generation) throw new Error('Connection changed while loading models. Refresh to try again.');
      const unique = [...new Map(models.filter((m) => m.value.trim()).map((m) => [m.value, m])).values()];
      if (unique.length) this.modelCache.set(id, { models: unique, expiresAt: Date.now() + 60_000 });
      else this.modelCache.delete(id);
      return unique;
    }).catch((err) => { if ((this.modelGeneration.get(id) ?? 0) === generation) this.modelCache.delete(id); throw err; }).finally(() => {
      if (this.modelInflight.get(id) === request) this.modelInflight.delete(id);
    });
    this.modelInflight.set(id, request);
    return request;
  }

  planUsage(id: ProviderId): PlanUsageDTO | null {
    return this.usage.get(id) ?? null;
  }

  /** Re-reads the plan's usage window (after a run, say). Returns true if it changed. */
  async refreshUsage(id: ProviderId): Promise<boolean> {
    const exe = this.connection(id).state === 'ready' ? this.executable(id) : null;
    return exe ? this.readUsage(id, exe) : false;
  }

  private async readUsage(id: ProviderId, executable: string): Promise<boolean> {
    const u = await this.probes[id].usage?.(executable).catch(() => null);
    return u ? this.recordUsage(id, u) : false;
  }

  /** Records the plan's rate-limit window (from a live run or a check). Returns true if it changed. */
  recordUsage(id: ProviderId, next: PlanUsageDTO): boolean {
    const prev = this.usage.get(id);
    this.usage.set(id, next);
    return JSON.stringify(prev) !== JSON.stringify(next);
  }
}
