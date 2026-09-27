/**
 * Task orchestration: per-agent FIFO queues, routing, lifecycle persistence and
 * event fan-out. Each agent runs at most one task at a time; different agents run
 * concurrently.
 *
 * Every state change goes DB first, then the bus, so a client that reconnects and
 * takes a snapshot never sees an older state than the events it already got.
 */
import {
  DEFAULTS,
  isTerminal,
  type CafeEvent,
  type ProviderId,
  type TaskDTO,
  type TaskEventData,
  type TaskEventDTO,
} from '@agent-cafe/shared';
import type { Db } from '../db/client.js';
import { toAgentDTO, toTaskDTO, toTaskEventDTO } from '../db/mappers.js';
import type { EventBus } from '../events/bus.js';
import type { Task } from '../generated/prisma/client.js';
import type { ProviderConfigService } from '../providers/config.js';
import type { AdapterResolver } from '../providers/registry.js';
import type { SettingsService } from '../settings.js';
import type { ToolRegistry } from '../tools/registry.js';
import { runTask, type RunOutcome } from './runner.js';

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
}

export interface OrchestratorDeps {
  db: Db;
  bus: EventBus;
  providers: ProviderConfigService;
  settings: SettingsService;
  tools: ToolRegistry;
  resolveAdapter: AdapterResolver;
  maxSteps?: number;
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
  private readonly seq = new Map<string, number>();
  private stopped = false;

  constructor(private readonly deps: OrchestratorDeps) {}

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** On boot: anything mid-run is marked interrupted (never silently re-billed); queues resume. */
  async recover(): Promise<void> {
    const { db } = this.deps;
    const stale = await db.task.findMany({ where: { status: { in: ['running', 'tool_wait'] } } });
    for (const t of stale) {
      await this.finish(t.id, {
        status: 'interrupted',
        error: 'The server stopped while this task was running. Nothing was re-sent; use Retry to run it again.',
      });
    }
    const queued = await db.task.findMany({ where: { status: 'queued' }, select: { agentId: true }, distinct: ['agentId'] });
    for (const { agentId } of queued) this.pump(agentId);
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
    const agent = await this.route(input.target);
    const mode = await providers.mode(agent.providerId as ProviderId);
    if (mode === 'off') {
      throw new OrchestratorError(`${agent.providerId} is switched off. Enable it in Settings.`, 'conflict');
    }
    const row = await db.task.create({
      data: {
        agentId: agent.id,
        providerId: agent.providerId,
        model: agent.model,
        prompt,
        isMock: mode === 'mock',
        maxCostUsd: input.maxCostUsd ?? DEFAULTS.maxCostUsd,
        retryOf: input.retryOf ?? null,
      },
    });
    const task = this.publishTask(row);
    await this.record(row.id, row.agentId, { kind: 'status', status: 'queued' });
    this.pump(agent.id);
    return task;
  }

  async cancel(taskId: string): Promise<TaskDTO> {
    const task = await this.deps.db.task.findUnique({ where: { id: taskId } });
    if (!task) throw new OrchestratorError('Task not found.', 'not_found');
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
    });
  }

  /** Full state for a newly connected client. */
  async snapshot(): Promise<Extract<CafeEvent, { type: 'snapshot' }>> {
    const { db, providers, settings } = this.deps;
    const [agents, active, recent] = await Promise.all([
      db.agent.findMany({ where: { archivedAt: null }, orderBy: { createdAt: 'asc' } }),
      db.task.findMany({ where: { status: { in: ['queued', 'running', 'tool_wait'] } } }),
      db.task.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }),
    ]);
    const tasks = new Map([...recent, ...active].map((t) => [t.id, toTaskDTO(t)]));
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
      settings: await settings.get(),
    };
  }

  // ── Routing ──────────────────────────────────────────────────────────────

  private async route(target: EnqueueTarget) {
    const { db } = this.deps;
    if ('agentId' in target) {
      const agent = await db.agent.findUnique({ where: { id: target.agentId } });
      if (!agent || agent.archivedAt) throw new OrchestratorError('Agent not found.', 'not_found');
      return agent;
    }
    // "Any idle": prefer a free agent, else the shortest queue. Ties go to the oldest agent.
    const candidates = await db.agent.findMany({
      where: { providerId: target.providerId, archivedAt: null, ...(target.model ? { model: target.model } : {}) },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { tasks: { where: { status: 'queued' } } } } },
    });
    if (candidates.length === 0) {
      const what = target.model ? `${target.providerId} agent using ${target.model}` : `${target.providerId} agent`;
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
      await this.execute(next, slot.ctrl);
      slot.taskId = null;
    }
  }

  private async execute(task: Task, ctrl: AbortController): Promise<void> {
    const { db, providers, tools, resolveAdapter } = this.deps;
    const providerId = task.providerId as ProviderId;
    const agent = await db.agent.findUniqueOrThrow({ where: { id: task.agentId } });

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
    if (mode === 'live' && (await providers.status(providerId)).closed) {
      await this.finish(task.id, {
        status: 'failed',
        failureKind: 'daily_cap',
        error: `${providerId} reached its daily spending cap. Closed for today.`,
      });
      return;
    }

    let adapter;
    try {
      adapter = await resolveAdapter(providerId, mode);
    } catch (err) {
      await this.finish(task.id, { status: 'failed', failureKind: 'provider_error', error: (err as Error).message });
      return;
    }

    const started = await db.task.update({
      where: { id: task.id },
      data: { isMock: adapter.kind === 'mock' },
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

    const outcome = await runTask({
      task: { prompt: task.prompt, model: task.model, maxCostUsd: task.maxCostUsd },
      agent: { systemPrompt: agent.systemPrompt },
      adapter,
      tools,
      signal: ctrl.signal,
      emit,
      ...(this.deps.maxSteps ? { maxSteps: this.deps.maxSteps } : {}),
    });
    await chain;
    await this.finish(task.id, outcomeToFinish(outcome));
    if (adapter.kind === 'live') this.deps.bus.publish({ type: 'provider.updated', provider: await providers.status(providerId) });
  }

  private async onRunEvent(taskId: string, agentId: string, e: TaskEventData): Promise<void> {
    const { db, bus } = this.deps;
    if (e.kind === 'model.delta') {
      bus.publish({ type: 'task.event', taskId, agentId, event: { ...e, seq: -1, at: new Date().toISOString() } });
      return;
    }
    await this.record(taskId, agentId, e);
    if (e.kind === 'status') {
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
        finishedAt: new Date(),
      },
    });
    await this.record(taskId, row.agentId, { kind: 'status', status: f.status, ...(f.error ? { note: f.error } : {}) });
    return this.publishTask(row);
  }

  /** Persist one event with the next per-task sequence number, then broadcast it. */
  private async record(taskId: string, agentId: string, data: TaskEventData): Promise<void> {
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
