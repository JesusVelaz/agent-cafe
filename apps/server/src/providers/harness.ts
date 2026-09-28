/**
 * Harness connections: is each floor's vendor agent installed and signed in, and
 * which models does it offer? Agent Café never handles credentials; it only asks
 * the installed CLI (`claude auth status`) and reads what it reports.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { query, type SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import {
  HARNESS,
  type HarnessConnectionDTO,
  type HarnessModelDTO,
  type PlanUsageDTO,
  type ProviderId,
} from '@agent-cafe/shared';

const run = promisify(execFile);

export interface HarnessProbe {
  /** Connection state plus the resolved executable path when installed. */
  check(): Promise<HarnessConnectionDTO & { executable: string | null }>;
  models(executable: string): Promise<HarnessModelDTO[]>;
}

const conn = (state: HarnessConnectionDTO['state'], extra: Partial<HarnessConnectionDTO> = {}): HarnessConnectionDTO => ({
  state, version: null, account: null, plan: null, message: null, checkedAt: new Date().toISOString(), ...extra,
});

/** The child environment for harness processes: never an API key, so runs bill the user's plan. */
export function harnessEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-cafe/0.1.0' };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

async function which(cmd: string): Promise<string | null> {
  try {
    const { stdout } = await run(process.platform === 'win32' ? 'where' : 'which', [cmd], { timeout: 5000 });
    return stdout.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

export const claudeCodeProbe: HarnessProbe = {
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
    const q = query({ prompt: noPrompt(), options: { pathToClaudeCodeExecutable: executable, env: harnessEnv(), persistSession: false } });
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
};

const unsupported = (id: ProviderId): HarnessProbe => ({
  check: async () => ({ ...conn('unsupported', { message: `${HARNESS[id].name} support is coming next. Use Demo for now.` }), executable: null }),
  models: async () => [],
});

export class HarnessService {
  private readonly probes: Record<ProviderId, HarnessProbe>;
  private readonly state = new Map<ProviderId, HarnessConnectionDTO & { executable: string | null }>();
  private readonly usage = new Map<ProviderId, PlanUsageDTO>();
  private readonly modelCache = new Map<ProviderId, HarnessModelDTO[]>();
  private readonly inflight = new Map<ProviderId, Promise<HarnessConnectionDTO>>();

  constructor(probes: Partial<Record<ProviderId, HarnessProbe>> = {}) {
    this.probes = { anthropic: claudeCodeProbe, openai: unsupported('openai'), ...probes };
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
      .then((s) => {
        this.state.set(id, s);
        if (s.state !== 'ready') this.modelCache.delete(id);
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

  async models(id: ProviderId): Promise<HarnessModelDTO[]> {
    const cached = this.modelCache.get(id);
    if (cached) return cached;
    const c = await this.ensure(id);
    const exe = this.executable(id);
    if (c.state !== 'ready' || !exe) return [];
    const models = await this.probes[id].models(exe);
    this.modelCache.set(id, models);
    return models;
  }

  planUsage(id: ProviderId): PlanUsageDTO | null {
    return this.usage.get(id) ?? null;
  }

  /** Records a rate-limit report from a live run. Returns true if it changed. */
  recordUsage(id: ProviderId, info: SDKRateLimitInfo): boolean {
    const next: PlanUsageDTO = {
      status: info.status,
      window: info.rateLimitType ?? null,
      utilization: info.utilization ?? null,
      // Epoch seconds (tolerate milliseconds too).
      resetsAt: info.resetsAt ? new Date(info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt).toISOString() : null,
    };
    const prev = this.usage.get(id);
    this.usage.set(id, next);
    return JSON.stringify(prev) !== JSON.stringify(next);
  }
}
