/**
 * The café server, played in the browser for the demo site. Same wire shapes as the
 * real server (snapshot, task.upserted, task.event…), so the store and scene can't
 * tell the difference. Everything lives in memory and resets on reload.
 */
import {
  DEFAULTS,
  HARNESS,
  PROVIDER_IDS,
  estimateCost,
  isActive,
  isTerminal,
  type AgentDTO,
  type AgentPermission,
  type ApprovalDTO,
  type CafeEvent,
  type ExchangeMetadata,
  type FailureKind,
  type ProjectDTO,
  type ProviderId,
  type ProviderStatusDTO,
  type TaskDTO,
  type TaskEventData,
  type TaskEventDTO,
  type TaskStatus,
} from '@agent-cafe/shared';
import { ApiError } from '../apiError';
import { DEMO_NOTE, scriptFor, type DemoStep, type Rng } from './script';

type Snapshot = Extract<CafeEvent, { type: 'snapshot' }>;
type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface DemoOptions {
  sleep?: Sleep;
  rng?: Rng;
  /** Chance a run fails partway (default 5%: failures and Retry should be seen, not constant). */
  failRate?: number;
}

export interface NewTask {
  prompt: string;
  agentId?: string;
  providerId?: ProviderId;
  model?: string;
  projectId?: string | null;
  permission?: AgentPermission;
  continueTaskId?: string;
  retryOf?: string;
  /** Demo traffic never stops to ask: nobody may be watching. */
  quiet?: boolean;
}

/** A finished task written straight into history (the seeded threads). */
export interface PastTask {
  agentId: string;
  prompt: string;
  /** When it started, in ms since the epoch. */
  at: number;
  projectId?: string | null;
  continueOf?: string | null;
  retryOf?: string | null;
  steps?: DemoStep[];
  failed?: { kind: FailureKind; error: string };
  exchange?: { kind: 'delegation' | 'result'; sourceTaskId: string; rootTaskId: string; meta: ExchangeMetadata; resultForTaskId?: string };
  threadTitle?: string;
  pinned?: boolean;
}

const abortError = () => new DOMException('Stopped', 'AbortError');

export const realSleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

const MAX_OUTPUT = 8192;
const words = (s: string) => s.match(/\S+\s*|\s+/g) ?? [s];
const outputTokens = (step: DemoStep) => Math.ceil(step.text.length / 4) + (step.tool ? 25 : 0);

export const AMBIENT_PROMPTS = [
  'Fix the flaky test where two orders arrive at once.',
  'Add tests for the order queue.',
  'Review the checkout route for edge cases.',
  'Find where we still use the legacy register.',
  'Group the menu board by category.',
  'Write a short README section on running the app.',
  'Add a seasonal drinks row to the menu board.',
  'Check how tax is rounded on large orders.',
];

class SimulatedFailure extends Error {}

export class DemoCafe {
  readonly agents = new Map<string, AgentDTO>();
  readonly tasks = new Map<string, TaskDTO>();
  readonly events = new Map<string, TaskEventDTO[]>();
  readonly projects = new Map<string, ProjectDTO>();
  private readonly listeners = new Set<(e: CafeEvent) => void>();
  private readonly slots = new Map<string, { taskId: string; ctrl: AbortController }>();
  private readonly approvals = new Map<string, { taskId: string; settle: (d: 'allow' | 'deny') => void }>();
  private readonly quiet = new Set<string>();
  private ids = 0;
  private traffic: ReturnType<typeof setTimeout> | null = null;
  private readonly sleep: Sleep;
  private readonly rng: Rng;
  private readonly failRate: number;

  constructor(opts: DemoOptions = {}) {
    this.sleep = opts.sleep ?? realSleep;
    this.rng = opts.rng ?? Math.random;
    this.failRate = opts.failRate ?? 0.05;
  }

  newId(prefix: string): string {
    return `${prefix}_${(++this.ids).toString(36)}${Math.floor(this.rng() * 1e6).toString(36)}`;
  }

  // ── Stream ───────────────────────────────────────────────────────────────

  subscribe(fn: (e: CafeEvent) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private publish(e: CafeEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  snapshot(): Snapshot {
    const lastEvents: Record<string, TaskEventDTO> = {};
    for (const t of this.tasks.values()) {
      const last = isActive(t.status) ? this.events.get(t.id)?.at(-1) : undefined;
      if (last) lastEvents[t.id] = last;
    }
    return {
      type: 'snapshot',
      agents: [...this.agents.values()].filter((a) => !a.archivedAt),
      tasks: [...this.tasks.values()],
      lastEvents,
      providers: PROVIDER_IDS.map((id) => this.provider(id)),
      projects: [...this.projects.values()],
    };
  }

  provider(id: ProviderId): ProviderStatusDTO {
    return {
      id,
      mode: 'mock',
      harness: HARNESS[id].id,
      connection: {
        state: 'unsupported',
        version: null,
        account: null,
        plan: null,
        message: 'Live runs need Agent Café on your own computer.',
        checkedAt: null,
      },
      usage: null,
      liveAvailable: false,
      closed: false,
    };
  }

  // ── Agents ───────────────────────────────────────────────────────────────

  addAgent(a: Omit<AgentDTO, 'id' | 'createdAt' | 'archivedAt' | 'projectId' | 'permission'> & Partial<AgentDTO>): AgentDTO {
    const agent: AgentDTO = {
      id: this.newId('agent'),
      projectId: null,
      permission: 'ask',
      createdAt: new Date().toISOString(),
      archivedAt: null,
      ...a,
    };
    this.agents.set(agent.id, agent);
    this.publish({ type: 'agent.upserted', agent });
    return agent;
  }

  updateAgent(id: string, change: Partial<Pick<AgentDTO, 'name' | 'model' | 'systemPrompt' | 'projectId' | 'permission' | 'spriteSeed'>>): AgentDTO {
    const prev = this.agents.get(id);
    if (!prev) throw new ApiError('Agent not found.', 404);
    const agent = { ...prev, ...change };
    this.agents.set(id, agent);
    this.publish({ type: 'agent.upserted', agent });
    return agent;
  }

  addProject(name: string, path: string): ProjectDTO {
    const project: ProjectDTO = { id: this.newId('project'), name, path, createdAt: new Date().toISOString() };
    this.projects.set(project.id, project);
    return project;
  }

  // ── Tasks ────────────────────────────────────────────────────────────────

  private blankTask(agent: AgentDTO, fields: Partial<TaskDTO> & Pick<TaskDTO, 'prompt' | 'createdAt'>): TaskDTO {
    return {
      id: this.newId('task'),
      agentId: agent.id,
      providerId: agent.providerId,
      model: agent.model,
      status: 'queued',
      isMock: true,
      maxCostUsd: DEFAULTS.maxCostUsd,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: estimateCost(fields.model ?? agent.model, 0, 0),
      steps: 0,
      output: null,
      error: null,
      failureKind: null,
      retryOf: null,
      projectId: null,
      permission: agent.permission,
      continueOf: null,
      sessionId: null,
      pendingApproval: null,
      startedAt: null,
      finishedAt: null,
      ...fields,
    };
  }

  createTask(input: NewTask): TaskDTO {
    const prompt = input.prompt.trim();
    if (!prompt) throw new ApiError('Prompt is empty.', 400);
    const agent = input.agentId ? this.agents.get(input.agentId) : this.route(input.providerId ?? 'anthropic', input.model);
    if (!agent || agent.archivedAt) throw new ApiError('Agent not found.', 404);
    const model = input.model?.trim() || agent.model;
    const permission = input.permission ?? agent.permission;
    const projectId = input.projectId === undefined ? agent.projectId : input.projectId;
    if (projectId && !this.projects.has(projectId)) throw new ApiError('That project no longer exists. Pick another one.', 400);
    let continueOf: string | null = null;
    if (input.continueTaskId) {
      const prev = this.tasks.get(input.continueTaskId);
      if (!prev) throw new ApiError('That conversation no longer exists. Start a new thread.', 404);
      if (prev.agentId !== agent.id) throw new ApiError('That conversation belongs to another agent.', 400);
      if (prev.projectId !== projectId) throw new ApiError('Follow-ups stay in the same project. Start a new thread to switch.', 400);
      continueOf = prev.id;
    }
    const task = this.blankTask(agent, {
      prompt,
      model,
      permission,
      projectId,
      continueOf,
      retryOf: input.retryOf ?? null,
      createdAt: new Date().toISOString(),
    });
    this.tasks.set(task.id, task);
    if (input.quiet) this.quiet.add(task.id);
    // The composer remembers each agent's last choices.
    if (agent.model !== model || agent.permission !== permission || agent.projectId !== projectId) {
      this.updateAgent(agent.id, { model, permission, projectId });
    }
    if (continueOf || task.retryOf) {
      const root = this.tasks.get(this.rootOf(task.id));
      if (root?.threadArchivedAt) this.update(root.id, { threadArchivedAt: null });
    }
    this.publish({ type: 'task.upserted', task });
    this.record(task.id, { kind: 'status', status: 'queued' });
    this.pump(agent.id);
    return task;
  }

  /** "Any idle": a free agent first, else the shortest queue; ties go to the oldest. */
  private route(providerId: ProviderId, model?: string): AgentDTO | undefined {
    const routed = model && model !== 'default' ? model : undefined;
    const candidates = [...this.agents.values()].filter((a) => a.providerId === providerId && !a.archivedAt && (!routed || a.model === routed));
    const load = (a: AgentDTO) => [...this.tasks.values()].filter((t) => t.agentId === a.id && t.status === 'queued').length + (this.slots.has(a.id) ? 1 : 0);
    if (!candidates.length) throw new ApiError(`No ${providerId} agent${routed ? ` using ${routed}` : ''} in the café.`, 404);
    return candidates.reduce((best, a) => (load(a) < load(best) ? a : best));
  }

  cancel(taskId: string): TaskDTO {
    const task = this.tasks.get(taskId);
    if (!task) throw new ApiError('Task not found.', 404);
    if (isTerminal(task.status)) return task;
    if (task.status === 'queued') return this.finish(taskId, { status: 'cancelled' });
    const slot = this.slots.get(task.agentId);
    if (slot?.taskId === taskId) slot.ctrl.abort();
    return this.tasks.get(taskId)!;
  }

  retry(taskId: string): TaskDTO {
    const task = this.tasks.get(taskId);
    if (!task) throw new ApiError('Task not found.', 404);
    if (!isTerminal(task.status)) throw new ApiError('Only finished tasks can be retried.', 409);
    return this.createTask({
      prompt: task.prompt,
      agentId: task.agentId,
      model: task.model,
      projectId: task.projectId,
      permission: task.permission,
      retryOf: task.id,
      ...(task.continueOf ? { continueTaskId: task.continueOf } : {}),
    });
  }

  answerApproval(taskId: string, approvalId: string, decision: 'allow' | 'deny'): TaskDTO {
    const pending = this.approvals.get(approvalId);
    if (!pending || pending.taskId !== taskId) throw new ApiError('That request was already answered or has expired.', 409);
    pending.settle(decision);
    return this.tasks.get(taskId)!;
  }

  history(taskId: string): { task: TaskDTO; events: TaskEventDTO[] } {
    const task = this.tasks.get(taskId);
    if (!task) throw new ApiError('Task not found.', 404);
    return { task, events: this.events.get(taskId) ?? [] };
  }

  // ── Threads ──────────────────────────────────────────────────────────────

  private rootOf(taskId: string): string {
    const seen = new Set<string>();
    let cur = this.tasks.get(taskId);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = cur.continueOf ?? cur.retryOf;
      const next = parent ? this.tasks.get(parent) : undefined;
      if (!next) break;
      cur = next;
    }
    return cur?.id ?? taskId;
  }

  /** A thread, plus the threads it delegated, and theirs in turn. */
  private threadWithDelegations(rootId: string): string[] {
    const all = new Set<string>();
    for (let roots = [rootId]; roots.length; ) {
      const members = [...this.tasks.values()].filter((t) => roots.includes(this.rootOf(t.id)) && !all.has(t.id)).map((t) => t.id);
      for (const id of members) all.add(id);
      roots = [...this.tasks.values()]
        .filter((t) => t.sourceTaskId && members.includes(t.sourceTaskId) && (t.exchangeKind === 'delegation' || t.exchangeKind === 'message') && !t.continueOf && !t.retryOf && !all.has(t.id))
        .map((t) => t.id);
    }
    return [...all];
  }

  updateThread(taskId: string, change: { title?: string | null; pinned?: boolean; archived?: boolean }): TaskDTO {
    if (!this.tasks.has(taskId)) throw new ApiError('Thread not found.', 404);
    const now = new Date().toISOString();
    return this.update(this.rootOf(taskId), {
      ...(change.title !== undefined ? { threadTitle: change.title?.trim() || null } : {}),
      ...(change.pinned !== undefined ? { threadPinnedAt: change.pinned ? now : null } : {}),
      ...(change.archived !== undefined ? { threadArchivedAt: change.archived ? now : null } : {}),
    })!;
  }

  deleteThread(taskId: string): { removed: string[] } {
    if (!this.tasks.has(taskId)) throw new ApiError('Thread not found.', 404);
    const ids = this.threadWithDelegations(this.rootOf(taskId));
    for (const id of ids) {
      const t = this.tasks.get(id)!;
      if (!isTerminal(t.status)) this.cancel(id);
    }
    for (const id of ids) {
      this.tasks.delete(id);
      this.events.delete(id);
    }
    this.publish({ type: 'task.removed', taskIds: ids });
    return { removed: ids };
  }

  // ── Running ──────────────────────────────────────────────────────────────

  private pump(agentId: string): void {
    if (this.slots.has(agentId)) return;
    const next = [...this.tasks.values()].find((t) => t.agentId === agentId && t.status === 'queued');
    if (!next) return;
    const slot = { taskId: next.id, ctrl: new AbortController() };
    this.slots.set(agentId, slot);
    void this.execute(next, slot.ctrl.signal)
      .catch((err) => console.error('[demo] run failed', err))
      .finally(() => {
        this.slots.delete(agentId);
        this.pump(agentId);
      });
  }

  private async execute(task: TaskDTO, signal: AbortSignal): Promise<void> {
    const id = task.id;
    this.update(id, { status: 'running', startedAt: new Date().toISOString() });
    this.record(id, { kind: 'status', status: 'running' });
    const steps = scriptFor(task.prompt, task.providerId);
    const failAt = this.rng() < this.failRate ? Math.floor(this.rng() * steps.length) : -1;
    try {
      for (let i = 0; i < steps.length; i++) {
        let step = steps[i]!;
        const n = i + 1;
        await this.sleep(500 + this.rng() * 1200, signal);
        if (i === failAt) throw new SimulatedFailure();

        this.record(id, { kind: 'model.start', step: n, maxOutputTokens: MAX_OUTPUT });
        for (const chunk of words(step.text)) {
          await this.sleep(20 + this.rng() * 45, signal);
          this.delta(id, n, chunk);
        }
        this.endTurn(id, n, step, 900 + n * 350 + Math.floor(this.rng() * 200));

        const tool = step.tool;
        if (!tool) return void this.finish(id, { status: 'completed', output: step.text });

        this.setStatus(id, 'tool_wait');
        const callId = this.newId('call');
        this.record(id, { kind: 'tool.start', step: n, callId, tool: tool.name, input: tool.input });
        if (tool.ask && !this.quiet.has(id) && task.permission === 'ask') {
          const decision = await this.ask(id, { tool: tool.name, summary: tool.ask.summary, reason: tool.ask.reason }, signal);
          if (signal.aborted) throw abortError();
          if (decision === 'deny') {
            this.record(id, { kind: 'tool.end', step: n, callId, tool: tool.name, ok: false, output: 'The user denied this action.' });
            this.setStatus(id, 'running');
            step = { text: `Understood, I didn't run \`${tool.ask.summary}\`. The changes are in place but unverified; run it yourself when you're ready.\n\n${DEMO_NOTE}` };
            await this.sleep(400 + this.rng() * 600, signal);
            this.record(id, { kind: 'model.start', step: n + 1, maxOutputTokens: MAX_OUTPUT });
            for (const chunk of words(step.text)) {
              await this.sleep(20 + this.rng() * 45, signal);
              this.delta(id, n + 1, chunk);
            }
            this.endTurn(id, n + 1, step, 1200 + n * 350);
            return void this.finish(id, { status: 'completed', output: step.text });
          }
        }
        await this.sleep(600 + this.rng() * 1400, signal);
        this.record(id, { kind: 'tool.end', step: n, callId, tool: tool.name, ok: true, output: tool.output });
        this.setStatus(id, 'running');
      }
    } catch (err) {
      if (signal.aborted) return void this.finish(id, { status: 'cancelled' });
      if (err instanceof SimulatedFailure) {
        return void this.finish(id, {
          status: 'failed',
          failureKind: 'provider_error',
          error: 'Simulated error: the espresso machine jammed. Retry to run it again.',
        });
      }
      throw err;
    }
  }

  private delta(taskId: string, step: number, text: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.publish({ type: 'task.event', taskId, agentId: task.agentId, event: { kind: 'model.delta', step, text, seq: -1, at: new Date().toISOString() } });
  }

  private endTurn(taskId: string, step: number, s: DemoStep, inputTokens: number, at?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const out = outputTokens(s);
    const costUsd = estimateCost(task.model, inputTokens, out);
    this.record(taskId, { kind: 'model.end', step, text: s.text, inputTokens, outputTokens: out, costUsd }, at);
    this.update(taskId, {
      steps: step,
      inputTokens: task.inputTokens + inputTokens,
      outputTokens: task.outputTokens + out,
      costUsd: costUsd === null ? task.costUsd : (task.costUsd ?? 0) + costUsd,
    });
  }

  private setStatus(taskId: string, status: TaskStatus): void {
    this.record(taskId, { kind: 'status', status });
    this.update(taskId, { status });
  }

  /** Parks the run on an Allow / Deny card until answered (or the task is stopped). */
  private ask(taskId: string, ask: Omit<ApprovalDTO, 'id' | 'requestedAt'>, signal: AbortSignal): Promise<'allow' | 'deny'> {
    const approval: ApprovalDTO = { id: this.newId('approval'), ...ask, requestedAt: new Date().toISOString() };
    return new Promise((resolve) => {
      const settle = (decision: 'allow' | 'deny') => {
        signal.removeEventListener('abort', onAbort);
        this.approvals.delete(approval.id);
        this.record(taskId, { kind: 'approval.resolved', approvalId: approval.id, decision });
        this.update(taskId, { pendingApproval: null });
        resolve(decision);
      };
      const onAbort = () => settle('deny');
      if (signal.aborted) return settle('deny');
      signal.addEventListener('abort', onAbort, { once: true });
      this.approvals.set(approval.id, { taskId, settle });
      this.record(taskId, { kind: 'approval.request', approval });
      this.update(taskId, { pendingApproval: approval });
    });
  }

  private finish(taskId: string, f: { status: 'completed' | 'failed' | 'cancelled'; output?: string; error?: string; failureKind?: FailureKind }): TaskDTO {
    const task = this.update(taskId, {
      status: f.status,
      output: f.output ?? null,
      error: f.error ?? null,
      failureKind: f.failureKind ?? null,
      pendingApproval: null,
      finishedAt: new Date().toISOString(),
    });
    this.record(taskId, { kind: 'status', status: f.status, ...(f.error ? { note: f.error } : {}) });
    this.quiet.delete(taskId);
    return task ?? this.tasks.get(taskId)!;
  }

  /** Changes a task and broadcasts it. A deleted task stays deleted. */
  private update(taskId: string, change: Partial<TaskDTO>): TaskDTO | undefined {
    const prev = this.tasks.get(taskId);
    if (!prev) return undefined;
    const task = { ...prev, ...change };
    this.tasks.set(taskId, task);
    this.publish({ type: 'task.upserted', task });
    return task;
  }

  private record(taskId: string, data: TaskEventData, at = new Date().toISOString()): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    const log = this.events.get(taskId) ?? [];
    const event = { ...data, seq: (log.at(-1)?.seq ?? -1) + 1, at } as TaskEventDTO;
    log.push(event);
    this.events.set(taskId, log);
    this.publish({ type: 'task.event', taskId, agentId: task.agentId, event });
  }

  // ── History (seeded threads) ─────────────────────────────────────────────

  /** Writes a whole finished run into history at once, with timestamps from `at` on. */
  addPast(p: PastTask): TaskDTO {
    const agent = this.agents.get(p.agentId);
    if (!agent) throw new Error(`No agent ${p.agentId}`);
    const iso = (ms: number) => new Date(ms).toISOString();
    const ex = p.exchange;
    const task = this.blankTask(agent, {
      prompt: p.prompt,
      projectId: p.projectId ?? null,
      continueOf: p.continueOf ?? null,
      retryOf: p.retryOf ?? null,
      createdAt: iso(p.at),
      startedAt: iso(p.at + 400),
      ...(ex ? { sourceTaskId: ex.sourceTaskId, exchangeKind: ex.kind, exchange: ex.meta, rootTaskId: ex.rootTaskId, exchangeDepth: 1, resultForTaskId: ex.resultForTaskId ?? null } : {}),
      ...(p.threadTitle ? { threadTitle: p.threadTitle } : {}),
      ...(p.pinned ? { threadPinnedAt: iso(p.at) } : {}),
    });
    this.tasks.set(task.id, task);
    const id = task.id;
    let t = p.at;
    const at = (gap: number) => iso((t += gap));
    this.record(id, { kind: 'status', status: 'queued' }, at(0));
    this.record(id, { kind: 'status', status: 'running' }, at(400));
    const steps = p.steps ?? scriptFor(p.prompt, agent.providerId);
    const lastStep = p.failed ? Math.max(1, steps.length - 2) : steps.length;
    for (let i = 0; i < lastStep; i++) {
      const step = steps[i]!;
      const n = i + 1;
      this.record(id, { kind: 'model.start', step: n, maxOutputTokens: MAX_OUTPUT }, at(1500));
      this.endTurn(id, n, step, 900 + n * 350, at(800 + step.text.length * 25));
      const tool = step.tool;
      if (!tool || (p.failed && i === lastStep - 1)) continue;
      const callId = this.newId('call');
      this.record(id, { kind: 'status', status: 'tool_wait' }, at(50));
      this.record(id, { kind: 'tool.start', step: n, callId, tool: tool.name, input: tool.input }, at(50));
      if (tool.ask) {
        const approval: ApprovalDTO = { id: this.newId('approval'), tool: tool.name, summary: tool.ask.summary, reason: tool.ask.reason, requestedAt: iso(t) };
        this.record(id, { kind: 'approval.request', approval }, at(0));
        this.record(id, { kind: 'approval.resolved', approvalId: approval.id, decision: 'allow' }, at(6000));
      }
      this.record(id, { kind: 'tool.end', step: n, callId, tool: tool.name, ok: true, output: tool.output }, at(1800));
      this.record(id, { kind: 'status', status: 'running' }, at(50));
    }
    const done = at(600);
    const final = p.failed
      ? { status: 'failed' as const, error: p.failed.error, failureKind: p.failed.kind, output: null }
      : { status: 'completed' as const, output: steps.at(-1)!.text, error: null, failureKind: null };
    this.record(id, { kind: 'status', status: final.status, ...(final.error ? { note: final.error } : {}) }, done);
    this.tasks.set(id, { ...this.tasks.get(id)!, ...final, finishedAt: done });
    return this.tasks.get(id)!;
  }

  // ── Demo traffic ─────────────────────────────────────────────────────────

  /** Every so often an idle agent picks up a sample task, so the café looks alive. */
  startTraffic(intervalMs = 14_000): void {
    if (this.traffic) return;
    const schedule = () => {
      this.traffic = setTimeout(() => {
        try {
          if (typeof document === 'undefined' || document.visibilityState === 'visible') this.trafficTick();
        } finally {
          schedule();
        }
      }, intervalMs * (0.5 + this.rng()));
    };
    schedule();
  }

  stopTraffic(): void {
    if (this.traffic) clearTimeout(this.traffic);
    this.traffic = null;
  }

  /** Queues one sample task on a random idle agent; returns it, if any. */
  trafficTick(): TaskDTO | null {
    // Leave room for the visitor's own work: at most half the café busy with samples.
    const busy = [...this.tasks.values()].filter((t) => !isTerminal(t.status)).length;
    if (busy >= Math.ceil(this.agents.size / 2)) return null;
    const idle = [...this.agents.values()].filter((a) => !a.archivedAt && !this.slots.has(a.id) && ![...this.tasks.values()].some((t) => t.agentId === a.id && t.status === 'queued'));
    if (!idle.length) return null;
    const agent = idle[Math.floor(this.rng() * idle.length)]!;
    const prompt = AMBIENT_PROMPTS[Math.floor(this.rng() * AMBIENT_PROMPTS.length)]!;
    return this.createTask({ agentId: agent.id, prompt, projectId: agent.projectId, quiet: true });
  }
}
