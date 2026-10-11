/**
 * Pure reducer from server CafeEvents to client state. Kept free of React/zustand
 * so it can be unit tested and reused by a future replay/time-travel view.
 */
import type {
  AgentDTO,
  CafeEvent,
  ProjectDTO,
  ProviderId,
  ProviderStatusDTO,
  TaskDTO,
  TaskEventDTO,
} from '@agent-cafe/shared';
import { exchangeMessage, isTerminal } from '@agent-cafe/shared';

/** Per-task event history kept client-side (the inspector fetches the full log on demand). */
export const MAX_EVENTS_PER_TASK = 300;

export interface CafeData {
  agents: Record<string, AgentDTO>;
  tasks: Record<string, TaskDTO>;
  providers: Partial<Record<ProviderId, ProviderStatusDTO>>;
  projects: Record<string, ProjectDTO>;
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
  projects: {},
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
        projects: Object.fromEntries(e.projects.map((p) => [p.id, p])),
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
    case 'task.removed': {
      const without = <T,>(rec: Record<string, T>) => {
        const next = { ...rec };
        for (const id of e.taskIds) delete next[id];
        return next;
      };
      return {
        ...s,
        tasks: without(s.tasks),
        events: without(s.events),
        lastEvent: without(s.lastEvent),
        lastActivityAt: without(s.lastActivityAt),
        streamText: without(s.streamText),
      };
    }
    case 'provider.updated':
      return { ...s, providers: { ...s.providers, [e.provider.id]: e.provider } };
    case 'project.upserted':
      return { ...s, projects: { ...s.projects, [e.project.id]: e.project } };
    case 'project.removed': {
      const projects = { ...s.projects };
      delete projects[e.projectId];
      return { ...s, projects };
    }
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

/** A conversation: one agent's chain of follow-ups (and retries). */
export interface ThreadSummary {
  /** The thread's first task. */
  id: string;
  agentId: string;
  /** The name given to the thread, else its first message without any routing line. */
  title: string;
  /** Kept at the top of the lists. */
  pinned: boolean;
  /** Hidden from the board and tucked under the agent's archived threads. */
  archived: boolean;
  projectId: string | null;
  /** Its tasks, oldest first. */
  taskIds: string[];
  /** Messages in the thread, delegation results included. */
  messages: number;
  /** The newest task: its status is the thread's, and opening the thread shows it. */
  last: TaskDTO;
  /** When the thread or its delegated work last changed. */
  at: string;
  /** For delegated work: who asked for it. */
  from: string | null;
  /** Work this thread delegated to other agents. */
  children: ThreadSummary[];
}

const LEGACY_SENDER = /^\[(?:Delegated task|Message) from ([^\s(\]]+)/;

interface ThreadIndex {
  threads: Map<string, ThreadSummary>;
  rootOf: Map<string, string>;
  /** Threads that aren't delegated work under another loaded thread. */
  top: ThreadSummary[];
}

let cache: { tasks: Record<string, TaskDTO>; index: ThreadIndex } | null = null;

/**
 * Every thread in the loaded tasks. A task joins the thread of the task it continues
 * (`continueOf`) or retries (`retryOf`); delegation results continue the asker's
 * thread. Delegated work starts its own thread, filed under the one that asked.
 */
function threadIndex(s: Pick<CafeData, 'tasks'>): ThreadIndex {
  if (cache?.tasks === s.tasks) return cache.index;
  const tasks = s.tasks;
  const rootOf = new Map<string, string>();
  const parentOf = (t: TaskDTO) => {
    const id = t.continueOf ?? t.retryOf;
    return id ? tasks[id] : undefined;
  };
  const findRoot = (id: string): string => {
    const known = rootOf.get(id);
    if (known) return known;
    const path: TaskDTO[] = [];
    const seen = new Set<string>();
    let cur = tasks[id]!;
    while (cur) {
      path.push(cur);
      seen.add(cur.id);
      const next = parentOf(cur);
      if (!next) break;
      if (rootOf.has(next.id)) {
        cur = next;
        break;
      }
      if (seen.has(next.id)) {
        // A loop: settle on its oldest task, so every member agrees.
        cur = path.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
        break;
      }
      cur = next;
    }
    const root = rootOf.get(cur.id) ?? cur.id;
    for (const t of path) rootOf.set(t.id, root);
    return root;
  };

  const members = new Map<string, TaskDTO[]>();
  for (const t of Object.values(tasks)) {
    const root = findRoot(t.id);
    const list = members.get(root);
    if (list) list.push(t);
    else members.set(root, [t]);
  }

  const threads = new Map<string, ThreadSummary>();
  for (const [rootId, list] of members) {
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const root = tasks[rootId]!;
    const last = list.at(-1)!;
    const delegated = root.exchangeKind === 'delegation' || root.exchangeKind === 'message';
    threads.set(rootId, {
      id: rootId,
      agentId: root.agentId,
      title: root.threadTitle || exchangeMessage(root).trim() || root.prompt,
      pinned: !!root.threadPinnedAt,
      archived: !!root.threadArchivedAt,
      projectId: root.projectId,
      taskIds: list.map((t) => t.id),
      messages: list.length,
      last,
      at: last.finishedAt ?? last.createdAt,
      from: delegated ? root.exchange?.senderName ?? root.prompt.match(LEGACY_SENDER)?.[1] ?? null : null,
      children: [],
    });
  }

  // Delegated threads hang under the thread that asked; if that one isn't loaded, they stand alone.
  const top: ThreadSummary[] = [];
  for (const th of threads.values()) {
    const root = tasks[th.id]!;
    const parent = th.from && root.sourceTaskId && tasks[root.sourceTaskId] ? threads.get(findRoot(root.sourceTaskId)) : undefined;
    if (parent && parent !== th) parent.children.push(th);
    else top.push(th);
  }
  const updateActivity = (th: ThreadSummary): string => {
    for (const child of th.children) {
      const at = updateActivity(child);
      if (at > th.at) th.at = at;
    }
    return th.at;
  };
  for (const th of top) updateActivity(th);
  // In the order the work was handed out.
  const sent = (th: ThreadSummary) => tasks[th.id]!.createdAt;
  for (const th of threads.values()) th.children.sort((a, b) => sent(a).localeCompare(sent(b)));

  const index = { threads, rootOf, top };
  cache = { tasks, index };
  return index;
}

const newestFirst = (a: ThreadSummary, b: ThreadSummary) => b.at.localeCompare(a.at);

/** A coordinator may finish its turn while its delegated threads are still working. */
export function workingThreads(th: ThreadSummary): number {
  return (isTerminal(th.last.status) ? 0 : 1) + th.children.reduce((n, child) => n + workingThreads(child), 0);
}

/** Threads at work first (in the order they started), then the rest, newest first. */
function workingFirst(list: ThreadSummary[]): ThreadSummary[] {
  const working = list.filter((th) => workingThreads(th) > 0).sort((a, b) => a.last.createdAt.localeCompare(b.last.createdAt));
  const rest = list.filter((th) => workingThreads(th) === 0).sort(newestFirst);
  return [...working, ...rest];
}

/** Pinned threads first, each part keeping its order. */
const pinnedFirst = (list: ThreadSummary[]) => [...list.filter((th) => th.pinned), ...list.filter((th) => !th.pinned)];

/** One project's threads on the board (projectId null: demo work, with no project). */
export interface ProjectGroup {
  projectId: string | null;
  /** Working first, then newest. */
  threads: ThreadSummary[];
  /** Threads at work right now. */
  working: number;
  /** The group's latest activity. */
  at: string;
}

/**
 * The board's threads by project: projects with work under way first, then by latest
 * activity; demo work (no project) last. Delegated work stays under its thread.
 * Archived threads are left off; pinned ones lead their project.
 */
export function projectGroups(s: Pick<CafeData, 'tasks'>): ProjectGroup[] {
  const byProject = new Map<string | null, ThreadSummary[]>();
  for (const th of threadIndex(s).top) {
    if (th.archived) continue;
    const list = byProject.get(th.projectId);
    if (list) list.push(th);
    else byProject.set(th.projectId, [th]);
  }
  const groups = [...byProject].map(([projectId, list]): ProjectGroup => ({
    projectId,
    threads: pinnedFirst(workingFirst(list)),
    working: list.reduce((n, th) => n + workingThreads(th), 0),
    at: list.reduce((a, th) => (th.at > a ? th.at : a), ''),
  }));
  return groups.sort((a, b) => {
    if ((a.projectId === null) !== (b.projectId === null)) return a.projectId === null ? 1 : -1;
    if ((a.working > 0) !== (b.working > 0)) return a.working > 0 ? -1 : 1;
    return b.at.localeCompare(a.at);
  });
}

/** All of one agent's threads (delegated work it did too, archived ones included): pinned, then newest activity first. */
export function agentThreads(s: Pick<CafeData, 'tasks'>, agentId: string): ThreadSummary[] {
  return pinnedFirst([...threadIndex(s).threads.values()].filter((th) => th.agentId === agentId).sort(newestFirst));
}

/** The thread a task belongs to. */
export function threadOf(s: Pick<CafeData, 'tasks'>, taskId: string): ThreadSummary | undefined {
  const { rootOf, threads } = threadIndex(s);
  const root = rootOf.get(taskId);
  return root ? threads.get(root) : undefined;
}

// ── Attention ────────────────────────────────────────────────────────────────

export type Attention =
  | { kind: 'approval'; agentId: string; task: TaskDTO }
  | { kind: 'stuck'; agentId: string; task: TaskDTO; quietSec: number }
  | { kind: 'failed'; agentId: string; task: TaskDTO };

/** How long a failure stays on the board unless retried or dismissed. */
export const FAILURE_TTL_MS = 60 * 60_000;

/**
 * What needs the user: actions waiting for approval (oldest first), running
 * demo tasks gone quiet past the stuck threshold, and
 * failures/interruptions that are still the agent's latest finished task (once
 * the agent finishes something newer, it has recovered), not yet retried or
 * dismissed, and under an hour old. Stuck first, then newest failures.
 */
export function needsAttention(
  s: Pick<CafeData, 'tasks' | 'lastActivityAt'>,
  now: number,
  dismissed: ReadonlySet<string> = new Set(),
  stuckAfterSec = 60,
): Attention[] {
  const tasks = Object.values(s.tasks);
  const retried = new Set(tasks.map((t) => t.retryOf).filter(Boolean) as string[]);
  const latestFinished = new Map<string, string>();
  for (const t of tasks) {
    if (!t.finishedAt || t.status === 'cancelled') continue;
    const cur = latestFinished.get(t.agentId);
    if (!cur || t.finishedAt > cur) latestFinished.set(t.agentId, t.finishedAt);
  }
  const approvals: Attention[] = [];
  const stuck: Attention[] = [];
  const failed: Attention[] = [];
  for (const t of tasks) {
    if (t.pendingApproval && (t.status === 'running' || t.status === 'tool_wait')) {
      approvals.push({ kind: 'approval', agentId: t.agentId, task: t });
    } else if (t.status === 'running' || t.status === 'tool_wait') {
      const since = s.lastActivityAt[t.id] ?? (t.startedAt ? Date.parse(t.startedAt) : now);
      const quietSec = (now - since) / 1000;
      // Live harnesses can think or run a command silently for minutes. No output
      // isn't evidence that they need the user; their approval/failure state is.
      if (t.isMock && quietSec > stuckAfterSec) stuck.push({ kind: 'stuck', agentId: t.agentId, task: t, quietSec });
    } else if (
      (t.status === 'failed' || t.status === 'interrupted') &&
      t.finishedAt &&
      now - Date.parse(t.finishedAt) < FAILURE_TTL_MS &&
      !retried.has(t.id) &&
      !dismissed.has(t.id) &&
      latestFinished.get(t.agentId) === t.finishedAt
    ) {
      failed.push({ kind: 'failed', agentId: t.agentId, task: t });
    }
  }
  failed.sort((a, b) => b.task.finishedAt!.localeCompare(a.task.finishedAt!));
  approvals.sort((a, b) => a.task.pendingApproval!.requestedAt.localeCompare(b.task.pendingApproval!.requestedAt));
  return [...approvals, ...stuck, ...failed];
}
