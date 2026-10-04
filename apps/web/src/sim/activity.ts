/**
 * What is this agent doing right now? Derived purely from orchestrator state, so
 * the roster, inspector and café scene always agree.
 */
import { DEFAULTS, type TaskDTO, type TaskEventDTO } from '@agent-cafe/shared';
import type { StationId } from './layout';

export type Activity =
  | { kind: 'idle' }
  | { kind: 'thinking'; step: number }
  | { kind: 'tool'; tool: string }
  | { kind: 'approval'; tool: string }
  | { kind: 'stuck'; quietSec: number }
  | { kind: 'done' }
  | { kind: 'failed' };

/** How long the ✓ / ! stays over an agent after a task ends. */
export const AFTERGLOW_MS = 8_000;

export interface ActivityInput {
  activeTask: TaskDTO | undefined;
  /** The agent's most recent task (active or finished). */
  latestTask: TaskDTO | undefined;
  lastEvent: TaskEventDTO | undefined;
  lastActivityAt: number | undefined;
  now: number;
}

export function deriveActivity({ activeTask, latestTask, lastEvent, lastActivityAt, now }: ActivityInput): Activity {
  if (activeTask) {
    // Waiting on you isn't being stuck.
    if (activeTask.pendingApproval) return { kind: 'approval', tool: activeTask.pendingApproval.tool };
    const since = lastActivityAt ?? (activeTask.startedAt ? Date.parse(activeTask.startedAt) : now);
    const quietSec = (now - since) / 1000;
    // Live harness silence can be normal thinking or a long-running tool.
    if (activeTask.isMock && quietSec > DEFAULTS.stuckAfterSec) return { kind: 'stuck', quietSec };
    if (lastEvent?.kind === 'tool.start') return { kind: 'tool', tool: lastEvent.tool };
    const step = lastEvent && 'step' in lastEvent ? lastEvent.step : 1;
    return { kind: 'thinking', step };
  }
  if (latestTask?.finishedAt && now - Date.parse(latestTask.finishedAt) < AFTERGLOW_MS) {
    if (latestTask.status === 'completed') return { kind: 'done' };
    if (latestTask.status === 'failed' || latestTask.status === 'interrupted') return { kind: 'failed' };
  }
  return { kind: 'idle' };
}

/**
 * Where each tool is performed, and how it reads. Covers the demo tools and
 * Claude Code's / Codex's own tool names; anything else is done at the desk.
 */
const TOOLS: Record<string, { station: StationId | null; label: string }> = {
  // Demo tools
  calculator: { station: 'register', label: 'Crunching numbers' },
  current_time: { station: 'clock', label: 'Checking the clock' },
  notes_read: { station: 'archive', label: 'Reading the archive' },
  notes_write: { station: 'archive', label: 'Filing a note' },
  read_file: { station: 'bookcase', label: 'Reading a file' },
  list_files: { station: 'bookcase', label: 'Browsing the shelves' },
  // Harness tools
  Read: { station: 'bookcase', label: 'Reading files' },
  Glob: { station: 'bookcase', label: 'Searching the code' },
  Grep: { station: 'bookcase', label: 'Searching the code' },
  LS: { station: 'bookcase', label: 'Browsing files' },
  WebFetch: { station: 'bookcase', label: 'Looking something up' },
  WebSearch: { station: 'bookcase', label: 'Searching the web' },
  Edit: { station: 'archive', label: 'Editing files' },
  MultiEdit: { station: 'archive', label: 'Editing files' },
  Write: { station: 'archive', label: 'Writing a file' },
  NotebookEdit: { station: 'archive', label: 'Editing a notebook' },
  TodoWrite: { station: 'archive', label: 'Updating the plan' },
  Bash: { station: 'register', label: 'Running a command' },
  PowerShell: { station: 'register', label: 'Running a command' },
  Task: { station: null, label: 'Delegating' },
  Agent: { station: null, label: 'Delegating' },
  // Codex
  shell: { station: 'register', label: 'Running a command' },
  apply_patch: { station: 'archive', label: 'Editing files' },
  web_search: { station: 'bookcase', label: 'Searching the web' },
  permissions: { station: null, label: 'Asking for access' },
};

/** Which station a tool is performed at (null: at the agent's own desk). */
export const stationFor = (tool: string): StationId | null => TOOLS[tool]?.station ?? null;

export const toolLabel = (tool: string): string => TOOLS[tool]?.label ?? `Using ${tool}`;

export function activityLabel(a: Activity): string {
  switch (a.kind) {
    case 'idle':
      return 'Idle';
    case 'thinking':
      return a.step > 1 ? `Thinking (step ${a.step})` : 'Thinking';
    case 'tool':
      return toolLabel(a.tool);
    case 'approval':
      return `Waiting for you: ${a.tool}`;
    case 'stuck':
      return `No activity for ${Math.floor(a.quietSec)}s`;
    case 'done':
      return 'Order up!';
    case 'failed':
      return 'Hit a problem';
  }
}
