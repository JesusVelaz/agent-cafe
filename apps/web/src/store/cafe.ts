'use client';

import type { CafeEvent, ModelInfo, TaskEventDTO } from '@agent-cafe/shared';
import { MODEL_CATALOG } from '@agent-cafe/shared';
import { create } from 'zustand';
import type { ConnectionState } from '@/lib/stream';
import { emptyData, MAX_EVENTS_PER_TASK, reduce, threadOf, type CafeData, type ThreadSummary } from './reduce';

interface CafeStore extends CafeData {
  connection: ConnectionState;
  catalog: readonly ModelInfo[];
  selectedAgentId: string | null;
  /**
   * With an agent open: a task in the thread being read (null shows their thread list).
   */
  selectedTaskId: string | null;
  /** With an agent open: composing a new thread with them (the list and threads are hidden). */
  composingThread: boolean;
  /** Failures the user has acknowledged, hidden from "Needs you". */
  dismissed: ReadonlySet<string>;
  /** The side panel is folded into a rail (remembered in this browser). */
  panelCollapsed: boolean;
  setPanelCollapsed(on: boolean): void;
  /** Which side the café is seen from: quarter turns (0–3) from the street corner (remembered in this browser). */
  viewAngle: number;
  /** Turn the café a quarter: 1 = the café turns left, −1 = right. */
  turnView(dir: 1 | -1): void;
  setViewAngle(quarter: number): void;
  dismiss(taskId: string): void;
  apply(e: CafeEvent): void;
  setConnection(c: ConnectionState): void;
  /** Open an agent: their thread list, or the thread holding `taskId`. */
  selectAgent(id: string | null, taskId?: string | null): void;
  /** Start a new thread with the open agent. */
  startThread(): void;
  /** Replace a task's log with the full history fetched from the server. */
  loadHistory(taskId: string, events: TaskEventDTO[]): void;
}

export function readFlag(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? '1' : '0');
  } catch {
    /* private mode: just not remembered */
  }
}

const VIEW_KEY = 'cafe.viewAngle';
const quarterOf = (n: number) => ((Math.round(n) % 4) + 4) % 4;

/** The side the café was last seen from in this browser (0 when unknown). */
export function readViewAngle(): number {
  try {
    return typeof localStorage === 'undefined' ? 0 : quarterOf(Number(localStorage.getItem(VIEW_KEY)) || 0);
  } catch {
    return 0;
  }
}
function writeViewAngle(q: number) {
  try {
    localStorage.setItem(VIEW_KEY, String(q));
  } catch {
    /* private mode: just not remembered */
  }
}

export const useCafe = create<CafeStore>((set) => ({
  ...emptyData(),
  connection: 'connecting',
  catalog: MODEL_CATALOG,
  selectedAgentId: null,
  selectedTaskId: null,
  composingThread: false,
  dismissed: new Set<string>(),
  // Read after mount (see CafeApp) so the server render matches the first client render.
  panelCollapsed: false,
  setPanelCollapsed: (panelCollapsed) => {
    writeFlag('cafe.panelCollapsed', panelCollapsed);
    set({ panelCollapsed });
  },
  // Like panelCollapsed, read after mount.
  viewAngle: 0,
  turnView: (dir) =>
    set((s) => {
      const viewAngle = quarterOf(s.viewAngle + dir);
      writeViewAngle(viewAngle);
      return { viewAngle };
    }),
  setViewAngle: (q) => {
    const viewAngle = quarterOf(q);
    writeViewAngle(viewAngle);
    set({ viewAngle });
  },
  dismiss: (taskId) => set((s) => ({ dismissed: new Set([...s.dismissed, taskId]) })),
  apply: (e) => set((s) => reduce(s, e)),
  setConnection: (connection) => set({ connection }),
  selectAgent: (selectedAgentId, selectedTaskId = null) => set({ selectedAgentId, selectedTaskId, composingThread: false }),
  startThread: () => set({ selectedTaskId: null, composingThread: true }),
  loadHistory: (taskId, history) =>
    set((s) => {
      // Merge: keep any live events that arrived after the fetch.
      const live = s.events[taskId] ?? [];
      const maxSeq = history.at(-1)?.seq ?? -1;
      const merged = [...history, ...live.filter((e) => e.seq > maxSeq)].slice(-MAX_EVENTS_PER_TASK);
      return { events: { ...s.events, [taskId]: merged } };
    }),
}));

export type AgentView = { kind: 'list' } | { kind: 'new' } | { kind: 'thread'; thread: ThreadSummary };

/** What the open agent's panel shows; null on the board. The composer follows it too. */
export function useAgentView(): AgentView | null {
  const agentId = useCafe((s) => s.selectedAgentId);
  const taskId = useCafe((s) => s.selectedTaskId);
  const composing = useCafe((s) => s.composingThread);
  const tasks = useCafe((s) => s.tasks);
  if (!agentId) return null;
  if (composing) return { kind: 'new' };
  const thread = taskId ? threadOf({ tasks }, taskId) : undefined;
  // A thread that's gone, or another agent's, falls back to the list.
  return thread && thread.agentId === agentId ? { kind: 'thread', thread } : { kind: 'list' };
}
