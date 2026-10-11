/**
 * Task orchestration: per-agent FIFO queues, routing, lifecycle persistence and
 * event fan-out. Each agent runs at most one task at a time; different agents run
 * concurrently.
 *
 * Every state change goes DB first, then the bus, so a client that reconnects and
 * takes a snapshot never sees an older state than the events it already got.
 */
import { randomUUID } from 'node:crypto';
import {
  DEFAULTS,
  HARNESS,
  exchangeMessage,
  offeredModel,
  isTerminal,
  type AgentPermission,
  type ApprovalDTO,
  type CafeEvent,
  type ProviderId,
  type TaskDTO,
  type TaskEventData,
  type TaskEventDTO,
} from '@agent-cafe/shared';
import type { Db } from '../db/client.js';
import { toAgentDTO, toProjectDTO, toTaskDTO, toTaskEventDTO } from '../db/mappers.js';
import { threadRootId, threadTaskIds, threadWithDelegations } from '../db/threads.js';
import type { EventBus } from '../events/bus.js';
import type { Task } from '../generated/prisma/client.js';
import { runClaudeTask } from '../providers/claude.js';
import { runCodexTask } from '../providers/codex.js';
import type { ProviderConfigService } from '../providers/config.js';
import type { ApprovalAsk, LiveRunners } from '../providers/live.js';
import type { AdapterResolver } from '../providers/registry.js';
import type { ToolRegistry } from '../tools/registry.js';
import { runTask, type RunOutcome } from './runner.js';
import { Collaboration, COLLABORATION_INSTRUCTIONS } from './collaboration.js';

const DEFAULT_RUNNERS: LiveRunners = { anthropic: runClaudeTask, openai: runCodexTask };

export class OrchestratorError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'conflict' | 'invalid',
  ) {
    super(message);
  }
}

export type EnqueueTarget = { agentId: string } | { providerId: ProviderId; model?: string };

export interface EnqueueInput {
  prompt: string;
  target: EnqueueTarget;
  maxCostUsd?: number;
  retryOf?: string;
  /** Defaults to the agent's last-used values. */
  projectId?: string | null;
  model?: string;
  permission?: AgentPermission;
  /** Continue the conversation of this earlier task (same agent and project). */
  continueTaskId?: string;
  /** Server-owned provenance, never accepted from the public create-task route. */
  collaboration?: {
    sourceTaskId: string;
    exchangeKind: 'message' | 'delegation' | 'result';
    rootTaskId: string;
    exchangeDepth: number;
    resultForTaskId?: string;
    exchangeData?: string;
  };
}

export interface OrchestratorDeps {
  db: Db;
  bus: EventBus;
  providers: ProviderConfigService;
  tools: ToolRegistry;
  resolveAdapter: AdapterResolver;
  maxSteps?: number;
  /** Live harness runners by floor (Claude Code upstairs, Codex downstairs). Injected in tests. */
  runLive?: Partial<LiveRunners>;
}

interface PendingApproval {
  taskId: string;
  resolve: (d: 'allow' | 'deny') => void;
}

interface Slot {
  taskId: string | null;
  ctrl: AbortController;
  /** Set when a task is enqueued while the drain loop is running, so it re-checks the queue. */
  dirty: boolean;
}

export class Orchestrator {
  private readonly slots = new Map<string, Slot>();
  private readonly drains = new Set<Promise<void>>();
  /** Each task being executed, until it has finished (and its result went out). */
  private readonly runs = new Map<string, Promise<void>>();
  /** Tasks of threads being deleted, or deleted: nothing new may continue, retry or be sent from them. */
  private readonly closedTasks = new Set<string>();
  private readonly seq = new Map<string, number>();
  private readonly approvals = new Map<string, PendingApproval>();
  private stopped = false;
  private recovering = false;
  private readonly collaboration: Collaboration;
  private readonly records = new Map<string, Promise<void>>();

  constructor(private readonly deps: OrchestratorDeps) {
    this.collaboration = new Collaboration({
      db: deps.db, enqueue: (input) => this.enqueue(input),
      mode: (id) => deps.providers.mode(id as ProviderId),
      log: (taskId, agentId, message) => this.record(taskId, agentId, { kind: 'log', level: 'info', message }),
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** On boot: anything mid-run is marked interrupted (never silently re-billed); queues resume. */
  async recover(): Promise<void> {
    this.recovering = true;
    const { db } = this.deps;
    const stale = await db.task.findMany({ where: { status: { in: ['running', 'tool_wait'] } } });
    for (const t of stale) {
      await this.finish(t.id, {
        status: 'interrupted',
        error: 'The server stopped while this task was running. Nothing was re-sent; use Retry to run it again.',
      });
    }
    this.recovering = false;
    const queued = await db.task.findMany({ where: { status: 'queued' }, select: { agentId: true }, distinct: ['agentId'] });
    for (const { agentId } of queued) this.pump(agentId);
    await this.collaboration.recover();
  }

  /** Abort running tasks (they end as cancelled) and stop picking up new ones. */
  async shutdown(): Promise<void> {
    this.stopped = true;
    for (const slot of this.slots.values()) slot.ctrl.abort();
    await this.idle();
  }

  /** Resolves once every agent's queue has drained. Used by tests and shutdown. */
  async idle(): Promise<void> {
    while (this.drains.size) await Promise.allSettled([...this.drains]);
  }

  isBusy(agentId: string): boolean {
    return this.slots.has(agentId);
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  async enqueue(input: EnqueueInput): Promise<TaskDTO> {
    const { db, providers } = this.deps;
    const prompt = input.prompt.trim();
    if (!prompt) throw new OrchestratorError('Prompt is empty.', 'invalid');
    // Checked first for a quick answer, and again just before the task is created (see below).
    this.assertOpenThread(input);
    const agent = await this.route(input.target);
    const mode = await providers.mode(agent.providerId as ProviderId);
    if (mode === 'off') {
      throw new OrchestratorError(`${agent.providerId} is switched off. Switch it to Live or Demo.`, 'conflict');
    }
    let model = input.model?.trim() || agent.model;
    let modelNote: string | null = null;
    const permission = input.permission ?? (agent.permission as AgentPermission);
    const projectId = input.projectId === undefined ? agent.projectId : input.projectId;
    if (projectId && !(await db.project.findUnique({ where: { id: projectId } }))) {
      throw new OrchestratorError('That project no longer exists. Pick another one.', 'invalid');
    }
    let continueOf: string | null = null;
    if (input.continueTaskId) {
      const prev = await db.task.findUnique({ where: { id: input.continueTaskId } });
      if (!prev) throw new OrchestratorError('That conversation no longer exists. Start a new thread.', 'not_found');
      if (prev.agentId !== agent.id) throw new OrchestratorError('That conversation belongs to another agent.', 'invalid');
      if (prev.projectId !== projectId) throw new OrchestratorError('Follow-ups stay in the same project. Start a new thread to switch.', 'invalid');
      continueOf = prev.id;
    }
    if (mode === 'live') {
      await this.assertLiveReady(agent, projectId);
      const providerId = agent.providerId as ProviderId;
      const available = await providers.harnesses.models(providerId).catch(() => { throw new OrchestratorError('Could not verify available models. Refresh the model list and try again.', 'conflict'); });
      if (!available.length) throw new OrchestratorError('No available models were reported. Refresh the model list before starting live work.', 'conflict');
      if (providerId === 'openai' && model === 'default') model = (available.find((m) => m.tag === 'Default') ?? available[0]!).value;
      if (!offeredModel(available, model)) {
        // Delegation uses an agent's saved preference, which may come from the demo catalog.
        // An explicit user choice must fail validation instead of silently changing models.
        if (input.model && !input.collaboration) {
          throw new OrchestratorError(`${model} isn't available in ${HARNESS[providerId].name} for this account. Pick one of: ${available.map((m) => m.label).join(', ')}.`, 'invalid');
        }
        const family = model.match(/-(sol|luna|terra|astra)$/)?.[0];
        const replacement = (family ? available.find((m) => m.value.endsWith(family)) : undefined)
          ?? available.find((m) => m.tag === 'Default') ?? available[0]!;
        modelNote = `Café: ${agent.name}'s saved model ${model} is unavailable. Using ${replacement.label}, available on this account.`;
        model = replacement.value;
      }
    }
    // No await between this check and the insert: a thread deleted while this task was being
    // checked (the live checks above can take seconds) can't gain a task that outlives it.
    this.assertOpenThread(input);
    const row = await db.task.create({
      data: {
        agentId: agent.id,
        providerId: agent.providerId,
        model,
        prompt,
        isMock: mode === 'mock',
        maxCostUsd: input.maxCostUsd ?? DEFAULTS.maxCostUsd,
        retryOf: input.retryOf ?? null,
        projectId,
        permission,
        continueOf,
        ...(input.collaboration ?? {}),
      },
    });
    // The composer remembers each agent's last choices.
    if (agent.model !== model || agent.permission !== permission || agent.projectId !== projectId) {
      const updated = await db.agent.update({ where: { id: agent.id }, data: { model, permission, projectId } });
      this.deps.bus.publish({ type: 'agent.upserted', agent: toAgentDTO(updated) });
    }
    if (row.continueOf || row.retryOf) await this.unarchiveThread(row.id);
    const task = this.publishTask(row);
    await this.record(row.id, row.agentId, { kind: 'status', status: 'queued' });
    if (modelNote) await this.record(row.id, row.agentId, { kind: 'log', level: 'info', message: modelNote });
    this.pump(agent.id);
    return task;
  }

  async cancel(taskId: string): Promise<TaskDTO> {
    const task = await this.deps.db.task.findUnique({ where: { id: taskId } });
    if (!task) throw new OrchestratorError('Task not found.', 'not_found');
    await this.collaboration.cancel(taskId);
    const children = await this.deps.db.task.findMany({ where: { sourceTaskId: taskId } });
    for (const child of children) await this.cancel(child.id);
    if (isTerminal(task.status as TaskDTO['status'])) return toTaskDTO(task);

    // Still queued? Cancel atomically, so it can't be claimed by the agent at the same moment.
    const unqueued = await this.deps.db.task.updateMany({
      where: { id: taskId, status: 'queued' },
      data: { status: 'cancelled' },
    });
    if (unqueued.count === 1) return this.finish(taskId, { status: 'cancelled' });

    // Already running: abort it; the run loop finalises it as cancelled.
    const slot = this.slots.get(task.agentId);
    if (slot?.taskId === taskId) slot.ctrl.abort();
    return toTaskDTO(await this.deps.db.task.findUniqueOrThrow({ where: { id: taskId } }));
  }

  /** The user's answer to a harness permission prompt. */
  async resolveApproval(taskId: string, approvalId: string, decision: 'allow' | 'deny'): Promise<TaskDTO> {
    const pending = this.approvals.get(approvalId);
    if (!pending || pending.taskId !== taskId) {
      throw new OrchestratorError('That request was already answered or has expired.', 'conflict');
    }
    pending.resolve(decision);
    return toTaskDTO(await this.deps.db.task.findUniqueOrThrow({ where: { id: taskId } }));
  }

  async retry(taskId: string): Promise<TaskDTO> {
    const task = await this.deps.db.task.findUnique({ where: { id: taskId } });
    if (!task) throw new OrchestratorError('Task not found.', 'not_found');
    if (!isTerminal(task.status as TaskDTO['status'])) {
      throw new OrchestratorError('Only finished tasks can be retried.', 'conflict');
    }
    return this.enqueue({
      prompt: task.prompt,
      target: { agentId: task.agentId },
      maxCostUsd: task.maxCostUsd,
      retryOf: task.id,
      projectId: task.projectId,
      model: task.model,
      permission: task.permission as AgentPermission,
      ...(task.continueOf ? { continueTaskId: task.continueOf } : {}),
      ...(task.sourceTaskId && task.rootTaskId && task.exchangeKind ? {
        collaboration: {
          sourceTaskId: task.sourceTaskId, rootTaskId: task.rootTaskId,
          exchangeKind: task.exchangeKind as 'message' | 'delegation' | 'result', exchangeDepth: task.exchangeDepth,
          ...(task.exchangeData ? { exchangeData: task.exchangeData } : {}),
        },
      } : {}),
    });
  }

  // ── Threads ──────────────────────────────────────────────────────────────

  /** Rename, pin or archive the thread `taskId` belongs to. An empty title resets the name. */
  async updateThread(taskId: string, change: { title?: string | null; pinned?: boolean; archived?: boolean }): Promise<TaskDTO> {
    const rootId = await threadRootId(this.deps.db, taskId);
    if (!rootId) throw new OrchestratorError('Thread not found.', 'not_found');
    const row = await this.deps.db.task.update({
      where: { id: rootId },
      data: {
        ...(change.title !== undefined ? { threadTitle: change.title?.trim() || null } : {}),
        ...(change.pinned !== undefined ? { threadPinnedAt: change.pinned ? new Date() : null } : {}),
        ...(change.archived !== undefined ? { threadArchivedAt: change.archived ? new Date() : null } : {}),
      },
    });
    return this.publishTask(row);
  }

  /**
   * Delete the thread `taskId` belongs to, with the threads it delegated. Each task is
   * closed as soon as it's found, so nothing new can join from it; work still queued or
   * running is cancelled, and everything is removed once it has fully stopped. Tasks
   * that joined before being closed are found by looking again, until nothing new turns up.
   */
  async deleteThread(taskId: string): Promise<{ removed: string[] }> {
    const { db, bus } = this.deps;
    const rootId = await threadRootId(db, taskId);
    if (!rootId) throw new OrchestratorError('Thread not found.', 'not_found');
    const ids = new Set<string>();
    try {
      for (;;) {
        const found = (await threadWithDelegations(db, rootId)).filter((id) => !ids.has(id));
        if (!found.length) break;
        for (const id of found) {
          ids.add(id);
          this.closedTasks.add(id);
        }
        const open = await db.task.findMany({ where: { id: { in: found }, status: { in: ['queued', 'running', 'tool_wait'] } } });
        for (const t of open) await this.cancel(t.id);
        await Promise.allSettled(found.flatMap((id) => [this.runs.get(id), this.records.get(id)]).filter(Boolean));
      }
      await db.$transaction([
        db.taskEvent.deleteMany({ where: { taskId: { in: [...ids] } } }),
        db.task.deleteMany({ where: { id: { in: [...ids] } } }),
      ]);
    } catch (err) {
      // Nothing was removed: the thread stays usable.
      for (const id of ids) this.closedTasks.delete(id);
      throw err;
    }
    bus.publish({ type: 'task.removed', taskIds: [...ids] });
    return { removed: [...ids] };
  }

  /** New work can't continue, retry or be sent from a thread that's being (or was) deleted. */
  private assertOpenThread(input: EnqueueInput): void {
    const from = [input.continueTaskId, input.retryOf, input.collaboration?.sourceTaskId];
    if (from.some((id) => id && this.closedTasks.has(id))) {
      throw new OrchestratorError('That thread was deleted. Start a new thread.', 'conflict');
    }
  }

  /** A thread that gets new work comes back out of the archive. */
  private async unarchiveThread(taskId: string): Promise<void> {
    const rootId = await threadRootId(this.deps.db, taskId);
    if (!rootId) return;
    const unarchived = await this.deps.db.task.updateMany({ where: { id: rootId, threadArchivedAt: { not: null } }, data: { threadArchivedAt: null } });
    if (unarchived.count) this.publishTask(await this.deps.db.task.findUniqueOrThrow({ where: { id: rootId } }));
  }

  /** Full state for a newly connected client. */
  async snapshot(): Promise<Extract<CafeEvent, { type: 'snapshot' }>> {
    const { db, providers } = this.deps;
    const [agents, active, recent, pinned] = await Promise.all([
      db.agent.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } }),
      db.task.findMany({ where: { status: { in: ['queued', 'running', 'tool_wait'] } } }),
      db.task.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
      db.task.findMany({ where: { threadPinnedAt: { not: null } }, select: { id: true } }),
    ]);
    const rows = new Map([...recent, ...active].map((t) => [t.id, t]));
    // Pinned threads stay on the board however old they are.
    const pinnedIds = (await Promise.all(pinned.map((p) => threadTaskIds(db, p.id)))).flat().filter((id) => !rows.has(id));
    for (const t of await db.task.findMany({ where: { id: { in: pinnedIds } } })) rows.set(t.id, t);
    // Each thread back to its first task, which holds the thread's name and settings.
    for (let missing = parentIds(rows); missing.length; missing = parentIds(rows)) {
      const found = await db.task.findMany({ where: { id: { in: missing } } });
      if (!found.length) break;
      for (const t of found) rows.set(t.id, t);
    }
    const tasks = new Map([...rows.values()].map((t) => [t.id, toTaskDTO(t)]));
    const lastEvents: Record<string, TaskEventDTO> = {};
    for (const t of active.filter((t) => t.status !== 'queued')) {
      const e = await db.taskEvent.findFirst({ where: { taskId: t.id }, orderBy: { seq: 'desc' } });
      if (e) lastEvents[t.id] = toTaskEventDTO(e);
    }
    return {
      type: 'snapshot',
      agents: agents.map(toAgentDTO),
      tasks: [...tasks.values()],
      lastEvents,
      providers: await providers.all(),
      projects: (await db.project.findMany({ orderBy: { createdAt: 'asc' } })).map(toProjectDTO),
    };
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  private async assertLiveReady(agent: { providerId: string }, projectId: string | null) {
    const providerId = agent.providerId as ProviderId;
    if (!HARNESS[providerId].live) throw new OrchestratorError(`Live ${HARNESS[providerId].name} runs are coming next.`, 'conflict');
    const c = await this.deps.providers.harnesses.ensure(providerId);
    if (c.state !== 'ready') {
      throw new OrchestratorError(c.message ?? `${HARNESS[providerId].name} isn't ready.`, 'conflict');
    }
    if (!projectId) throw new OrchestratorError('Pick a project for this task first.', 'invalid');
  }

  private async route(target: EnqueueTarget) {
    const { db } = this.deps;
    if ('agentId' in target) {
      const agent = await db.agent.findUnique({ where: { id: target.agentId } });
      if (!agent || agent.archivedAt) throw new OrchestratorError('Agent not found.', 'not_found');
      return agent;
    }
    // "Any idle": prefer a free agent, else the shortest queue. Ties go to the oldest agent.
    // `default` is a harness-level alias, not a concrete model saved on an agent.
    const routedModel = target.model && target.model !== 'default' ? target.model : undefined;
    const candidates = await db.agent.findMany({
      where: { providerId: target.providerId, archivedAt: null, ...(routedModel ? { model: routedModel } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { tasks: { where: { status: 'queued' } } } } },
    });
    if (candidates.length === 0) {
      const what = routedModel ? `${target.providerId} agent using ${routedModel}` : `${target.providerId} agent`;
      throw new OrchestratorError(`No ${what} in the café. Hire one first.`, 'not_found');
    }
    const load = (a: (typeof candidates)[number]) => a._count.tasks + (this.isBusy(a.id) ? 1 : 0);
    return candidates.reduce((best, a) => (load(a) < load(best) ? a : best));
  }

  // ── Execution ────────────────────────────────────────────────────────────

  private pump(agentId: string): void {
    if (this.stopped) return;
    const existing = this.slots.get(agentId);
    if (existing) {
      existing.dirty = true;
      return;
    }
    const slot: Slot = { taskId: null, ctrl: new AbortController(), dirty: false };
    this.slots.set(agentId, slot);
    const drain = this.drain(agentId, slot)
      .catch((err) => console.error(`[orchestrator] agent ${agentId} drain failed`, err))
      .finally(() => {
        this.slots.delete(agentId);
        this.drains.delete(drain);
      });
    this.drains.add(drain);
  }

  private async drain(agentId: string, slot: Slot): Promise<void> {
    while (!this.stopped) {
      slot.dirty = false;
      const next = await this.deps.db.task.findFirst({
        where: { agentId, status: 'queued' },
        orderBy: { createdAt: 'asc' },
      });
      if (!next) {
        if (slot.dirty) continue;
        return;
      }
      slot.taskId = next.id;
      slot.ctrl = new AbortController();
      const run = this.execute(next, slot.ctrl);
      this.runs.set(next.id, run);
      try {
        await run;
      } finally {
        this.runs.delete(next.id);
      }
      slot.taskId = null;
    }
  }

  private async execute(task: Task, ctrl: AbortController): Promise<void> {
    const { db, providers, tools, resolveAdapter } = this.deps;
    const providerId = task.providerId as ProviderId;
    const agent = await db.agent.findUniqueOrThrow({ where: { id: task.agentId } });
    const harnessPrompt = task.exchangeKind ? this.exchangePrompt(task) : task.prompt;

    // Atomic claim: if the task was cancelled while we were picking it up, skip it.
    const claimed = await db.task.updateMany({
      where: { id: task.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    });
    if (claimed.count === 0) return;

    // Mode is decided when the task starts, and recorded on the task (isMock).
    const mode = await providers.mode(providerId);
    if (mode === 'off') {
      await this.finish(task.id, { status: 'failed', failureKind: 'provider_error', error: `${providerId} was switched off.` });
      return;
    }
    const project = task.projectId ? await db.project.findUnique({ where: { id: task.projectId } }) : null;
    // A follow-up resumes the harness session of the task it continues (known once that task started).
    const resume = task.continueOf
      ? (await db.task.findUnique({ where: { id: task.continueOf }, select: { sessionId: true } }))?.sessionId ?? undefined
      : undefined;
    if (mode === 'live') {
      const c = await providers.harnesses.ensure(providerId);
      if (c.state !== 'ready' || !providers.harnesses.executable(providerId)) {
        await this.finish(task.id, { status: 'failed', failureKind: 'signed_out', error: c.message ?? `${HARNESS[providerId].name} isn't ready.` });
        return;
      }
      if (!project) {
        await this.finish(task.id, { status: 'failed', failureKind: 'provider_error', error: 'This task has no project to work in.' });
        return;
      }
    }

    let adapter;
    if (mode === 'mock') {
      try {
        adapter = await resolveAdapter(providerId, mode);
      } catch (err) {
        await this.finish(task.id, { status: 'failed', failureKind: 'provider_error', error: (err as Error).message });
        return;
      }
    }

    const started = await db.task.update({
      where: { id: task.id },
      data: { isMock: adapter?.kind === 'mock' },
    });
    this.publishTask(started);
    await this.record(task.id, task.agentId, { kind: 'status', status: 'running' });

    // Events are persisted in order through a promise chain; deltas skip the DB.
    let chain: Promise<unknown> = Promise.resolve();
    const emit = (e: TaskEventData) => {
      chain = chain.then(() => this.onRunEvent(task.id, task.agentId, e)).catch((err) => {
        console.error('[orchestrator] event persist failed', err);
      });
    };

    const outcome = adapter
      ? await runTask({
          task: { prompt: task.prompt, model: task.model, maxCostUsd: task.maxCostUsd },
          agent: { systemPrompt: agent.systemPrompt },
          adapter,
          tools,
          signal: ctrl.signal,
          emit,
          ...(this.deps.maxSteps ? { maxSteps: this.deps.maxSteps } : {}),
        })
      : await this.liveRunner(providerId)({
          task: { prompt: harnessPrompt, model: task.model },
          agent: { systemPrompt: `${agent.systemPrompt}\n\n${COLLABORATION_INSTRUCTIONS}`, workDir: project!.path, permission: task.permission as AgentPermission },
          collaboration: this.collaboration.forTask(task.id, ctrl.signal),
          executable: providers.harnesses.executable(providerId)!,
          ...(resume ? { resume } : {}),
          onSession: (sessionId) => {
            chain = chain.then(async () => this.publishTask(await db.task.update({ where: { id: task.id }, data: { sessionId } })));
          },
          signal: ctrl.signal,
          emit,
          approve: (ask, signal) => this.askUser(task.id, ask, emit, signal),
          onUsage: (usage) => {
            if (!providers.harnesses.recordUsage(providerId, usage)) return;
            void providers.status(providerId).then((provider) => this.deps.bus.publish({ type: 'provider.updated', provider }));
          },
        });
    await chain;
    await this.finish(task.id, outcomeToFinish(outcome));
    // A live run used some of the plan: re-read the window so the bar keeps up (in the background).
    if (!adapter) {
      void providers.harnesses
        .refreshUsage(providerId)
        .then(async (changed) => changed && this.deps.bus.publish({ type: 'provider.updated', provider: await providers.status(providerId) }))
        .catch(() => {});
    }
  }

  private liveRunner(providerId: ProviderId) {
    return this.deps.runLive?.[providerId] ?? DEFAULT_RUNNERS[providerId];
  }

  /** Attribution and continuation guidance go to the harness, never into the visible message. */
  private exchangePrompt(task: Task): string {
    const dto = toTaskDTO(task);
    const sender = dto.exchange ? `${dto.exchange.senderName} (${dto.exchange.senderProviderId})` : 'a teammate';
    const header = task.exchangeKind === 'result'
      ? `Delegation result from ${sender}: ${dto.exchange?.status ?? 'finished'}`
      : `${task.exchangeKind === 'delegation' ? 'Delegated task' : 'Message'} from ${sender}`;
    return `[${header}]\n${exchangeMessage(dto)}${task.exchangeKind === 'result' ? '\n\nContinue the original request using this result. Other delegated tasks may still be pending.' : ''}`;
  }

  /** Parks a harness permission prompt until the user answers (or the task is cancelled). */
  private askUser(taskId: string, ask: ApprovalAsk, emit: (e: TaskEventData) => void, signal: AbortSignal): Promise<'allow' | 'deny'> {
    const approval: ApprovalDTO = { id: randomUUID(), ...ask, requestedAt: new Date().toISOString() };
    return new Promise((resolve) => {
      const settle = (decision: 'allow' | 'deny') => {
        signal.removeEventListener('abort', onAbort);
        this.approvals.delete(approval.id);
        emit({ kind: 'approval.resolved', approvalId: approval.id, decision });
        resolve(decision);
      };
      const onAbort = () => settle('deny');
      if (signal.aborted) return settle('deny');
      signal.addEventListener('abort', onAbort, { once: true });
      this.approvals.set(approval.id, { taskId, resolve: settle });
      emit({ kind: 'approval.request', approval });
    });
  }

  private async onRunEvent(taskId: string, agentId: string, e: TaskEventData): Promise<void> {
    const { db, bus } = this.deps;
    if (e.kind === 'model.delta') {
      bus.publish({ type: 'task.event', taskId, agentId, event: { ...e, seq: -1, at: new Date().toISOString() } });
      return;
    }
    await this.record(taskId, agentId, e);
    if (e.kind === 'approval.request') {
      this.publishTask(await db.task.update({ where: { id: taskId }, data: { pendingApproval: JSON.stringify(e.approval) } }));
    } else if (e.kind === 'approval.resolved') {
      this.publishTask(await db.task.update({ where: { id: taskId }, data: { pendingApproval: null } }));
    } else if (e.kind === 'status') {
      this.publishTask(await db.task.update({ where: { id: taskId }, data: { status: e.status } }));
    } else if (e.kind === 'model.end') {
      const t = await db.task.findUniqueOrThrow({ where: { id: taskId } });
      this.publishTask(
        await db.task.update({
          where: { id: taskId },
          data: {
            steps: e.step,
            inputTokens: t.inputTokens + e.inputTokens,
            outputTokens: t.outputTokens + e.outputTokens,
            costUsd: e.costUsd === null ? t.costUsd : (t.costUsd ?? 0) + e.costUsd,
          },
        }),
      );
    }
  }

  // ── Persistence helpers ──────────────────────────────────────────────────

  private async finish(taskId: string, f: FinishFields): Promise<TaskDTO> {
    const { db } = this.deps;
    const row = await db.task.update({
      where: { id: taskId },
      data: {
        status: f.status,
        output: f.output ?? null,
        error: f.error ?? null,
        failureKind: f.failureKind ?? null,
        pendingApproval: null,
        finishedAt: new Date(),
      },
    });
    await this.record(taskId, row.agentId, { kind: 'status', status: f.status, ...(f.error ? { note: f.error } : {}) });
    const task = this.publishTask(row);
    if (!this.stopped && !this.recovering) await this.collaboration.deliver(row).catch(async (err) => {
      await this.record(row.id, row.agentId, { kind: 'log', level: 'warn', message: `Café: Result delivery pending: ${(err as Error).message}` });
    });
    return task;
  }

  /** Persist one event with the next per-task sequence number, then broadcast it. */
  private record(taskId: string, agentId: string, data: TaskEventData): Promise<void> {
    const next = (this.records.get(taskId) ?? Promise.resolve()).then(() => this.persistRecord(taskId, agentId, data));
    const tail = next.catch(() => {});
    this.records.set(taskId, tail);
    void tail.then(() => { if (this.records.get(taskId) === tail) this.records.delete(taskId); });
    return next;
  }

  private async persistRecord(taskId: string, agentId: string, data: TaskEventData): Promise<void> {
    const { db, bus } = this.deps;
    let seq = this.seq.get(taskId);
    if (seq === undefined) {
      const last = await db.taskEvent.findFirst({ where: { taskId }, orderBy: { seq: 'desc' }, select: { seq: true } });
      seq = last ? last.seq : -1;
    }
    seq += 1;
    this.seq.set(taskId, seq);
    const row = await db.taskEvent.create({ data: { taskId, seq, kind: data.kind, payload: JSON.stringify(data) } });
    bus.publish({ type: 'task.event', taskId, agentId, event: toTaskEventDTO(row) });
    if (data.kind === 'status' && isTerminal(data.status)) this.seq.delete(taskId);
  }

  private publishTask(row: Task): TaskDTO {
    const task = toTaskDTO(row);
    this.deps.bus.publish({ type: 'task.upserted', task });
    return task;
  }
}

/** Tasks that loaded tasks continue or retry, but that aren't loaded themselves. */
function parentIds(rows: Map<string, Task>): string[] {
  const ids = new Set<string>();
  for (const t of rows.values()) {
    const parent = t.continueOf ?? t.retryOf;
    if (parent && !rows.has(parent)) ids.add(parent);
  }
  return [...ids];
}

interface FinishFields {
  status: 'completed' | 'failed' | 'cancelled' | 'interrupted';
  output?: string;
  error?: string;
  failureKind?: TaskDTO['failureKind'];
}

function outcomeToFinish(o: RunOutcome): FinishFields {
  switch (o.status) {
    case 'completed':
      return { status: 'completed', output: o.output };
    case 'failed':
      return { status: 'failed', failureKind: o.failureKind, error: o.error };
    case 'cancelled':
      return { status: 'cancelled' };
  }
}
