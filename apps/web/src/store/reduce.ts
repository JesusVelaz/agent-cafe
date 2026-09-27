/**
 * Pure reducer from server CafeEvents to client state. Kept free of React/zustand
 * so it can be unit tested and reused by a future replay/time-travel view.
 */
import type {
  AgentDTO,
  CafeEvent,
  ProviderId,
  ProviderStatusDTO,
  SettingsDTO,
  TaskDTO,
  TaskEventDTO,
} from '@agent-cafe/shared';

/** Per-task event history kept client-side (the inspector fetches the full log on demand). */
export const MAX_EVENTS_PER_TASK = 300;

export interface CafeData {
  agents: Record<string, AgentDTO>;
  tasks: Record<string, TaskDTO>;
  providers: Partial<Record<ProviderId, ProviderStatusDTO>>;
  settings: SettingsDTO;
  /** Persisted events seen for each task, in seq order. */
  events: Record<string, TaskEventDTO[]>;
  /** Latest persisted (non-delta) event per task: drives the café scene. */
  lastEvent: Record<string, TaskEventDTO>;
  /** Epoch ms of the last sign of life (including deltas) per task, for stuck detection. */
  lastActivityAt: Record<string, number>;
  /** Streaming text of the current model step, per task. */
  streamText: Record<string, string>;
  hydrated: boolean;
}

export const emptyData = (): CafeData => ({
  agents: {},
  tasks: {},
  providers: {},
  settings: { ambient: false },
  events: {},
  lastEvent: {},
  lastActivityAt: {},
  streamText: {},
  hydrated: false,
});

export function reduce(s: CafeData, e: CafeEvent, now: number = Date.now()): CafeData {
  switch (e.type) {
    case 'snapshot': {
      const tasks = Object.fromEntries(e.tasks.map((t) => [t.id, t]));
      const lastActivityAt: Record<string, number> = {};
      for (const [id, ev] of Object.entries(e.lastEvents)) lastActivityAt[id] = Date.parse(ev.at);
      return {
        agents: Object.fromEntries(e.agents.map((a) => [a.id, a])),
        tasks,
        providers: Object.fromEntries(e.providers.map((p) => [p.id, p])),
        settings: e.settings,
        events: Object.fromEntries(Object.entries(e.lastEvents).map(([id, ev]) => [id, [ev]])),
        lastEvent: { ...e.lastEvents },
        lastActivityAt,
        streamText: {},
        hydrated: true,
      };
    }
    case 'agent.upserted': {
      const agents = { ...s.agents };
      if (e.agent.archivedAt) delete agents[e.agent.id];
      else agents[e.agent.id] = e.agent;
      return { ...s, agents };
    }
    case 'task.upserted':
      return { ...s, tasks: { ...s.tasks, [e.task.id]: e.task } };
    case 'provider.updated':
      return { ...s, providers: { ...s.providers, [e.provider.id]: e.provider } };
    case 'settings.updated':
      return { ...s, settings: e.settings };
    case 'task.event': {
      const { taskId, event } = e;
      const lastActivityAt = { ...s.lastActivityAt, [taskId]: now };
      if (event.kind === 'model.delta') {
        return {
          ...s,
          lastActivityAt,
          streamText: { ...s.streamText, [taskId]: (s.streamText[taskId] ?? '') + event.text },
        };
      }
      const prev = s.events[taskId] ?? [];
      const events = { ...s.events, [taskId]: [...prev, event].slice(-MAX_EVENTS_PER_TASK) };
      let streamText = s.streamText;
      if (event.kind === 'model.start') streamText = { ...streamText, [taskId]: '' };
      if (event.kind === 'model.end') streamText = { ...streamText, [taskId]: event.text };
      return { ...s, events, lastEvent: { ...s.lastEvent, [taskId]: event }, lastActivityAt, streamText };
    }
  }
}

// ── Selectors ────────────────────────────────────────────────────────────────

const byCreated = (a: TaskDTO, b: TaskDTO) => a.createdAt.localeCompare(b.createdAt);

export function activeTaskFor(s: Pick<CafeData, 'tasks'>, agentId: string): TaskDTO | undefined {
  return Object.values(s.tasks).find(
    (t) => t.agentId === agentId && (t.status === 'running' || t.status === 'tool_wait'),
  );
}

export function queuedFor(s: Pick<CafeData, 'tasks'>, agentId?: string): TaskDTO[] {
  return Object.values(s.tasks)
    .filter((t) => t.status === 'queued' && (!agentId || t.agentId === agentId))
    .sort(byCreated);
}

export function tasksFor(s: Pick<CafeData, 'tasks'>, agentId: string): TaskDTO[] {
  return Object.values(s.tasks)
    .filter((t) => t.agentId === agentId)
    .sort((a, b) => byCreated(b, a));
}

/** The agent's most recent task: the one shown by default in the inspector. */
export function latestTaskFor(s: Pick<CafeData, 'tasks'>, agentId: string): TaskDTO | undefined {
  return activeTaskFor(s, agentId) ?? tasksFor(s, agentId)[0];
}

/** Recently finished tasks, newest first (cups on the pickup counter). */
export function recentFinished(s: Pick<CafeData, 'tasks'>, limit: number): TaskDTO[] {
  return Object.values(s.tasks)
    .filter((t) => t.finishedAt && (t.status === 'completed' || t.status === 'failed'))
    .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))
    .slice(0, limit);
}
