'use client';

import type { CafeEvent, ModelInfo, TaskEventDTO } from '@agent-cafe/shared';
import { MODEL_CATALOG } from '@agent-cafe/shared';
import { create } from 'zustand';
import type { ConnectionState } from '@/lib/stream';
import { emptyData, MAX_EVENTS_PER_TASK, reduce, type CafeData } from './reduce';

interface CafeStore extends CafeData {
  connection: ConnectionState;
  catalog: readonly ModelInfo[];
  selectedAgentId: string | null;
  /** When set, the inspector shows this task instead of the agent's latest. */
  selectedTaskId: string | null;
  /** Failures the user has acknowledged, hidden from "Needs you". */
  dismissed: ReadonlySet<string>;
  /** The side panel is folded into a rail (remembered in this browser). */
  panelCollapsed: boolean;
  setPanelCollapsed(on: boolean): void;
  dismiss(taskId: string): void;
  apply(e: CafeEvent): void;
  setConnection(c: ConnectionState): void;
  selectAgent(id: string | null, taskId?: string | null): void;
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

export const useCafe = create<CafeStore>((set) => ({
  ...emptyData(),
  connection: 'connecting',
  catalog: MODEL_CATALOG,
  selectedAgentId: null,
  selectedTaskId: null,
  dismissed: new Set<string>(),
  // Read after mount (see CafeApp) so the server render matches the first client render.
  panelCollapsed: false,
  setPanelCollapsed: (panelCollapsed) => {
    writeFlag('cafe.panelCollapsed', panelCollapsed);
    set({ panelCollapsed });
  },
  dismiss: (taskId) => set((s) => ({ dismissed: new Set([...s.dismissed, taskId]) })),
  apply: (e) => set((s) => reduce(s, e)),
  setConnection: (connection) => set({ connection }),
  selectAgent: (selectedAgentId, selectedTaskId = null) => set({ selectedAgentId, selectedTaskId }),
  loadHistory: (taskId, history) =>
    set((s) => {
      // Merge: keep any live events that arrived after the fetch.
      const live = s.events[taskId] ?? [];
      const maxSeq = history.at(-1)?.seq ?? -1;
      const merged = [...history, ...live.filter((e) => e.seq > maxSeq)].slice(-MAX_EVENTS_PER_TASK);
      return { events: { ...s.events, [taskId]: merged } };
    }),
}));
