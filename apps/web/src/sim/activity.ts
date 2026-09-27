/**
 * What is this agent doing right now? Derived purely from orchestrator state, so
 * the roster, inspector and café scene always agree.
 */
import { DEFAULTS, type TaskDTO, type TaskEventDTO, type ToolName } from '@agent-cafe/shared';
import type { StationId } from './layout';

export type Activity =
  | { kind: 'idle' }
  | { kind: 'thinking'; step: number }
  | { kind: 'tool'; tool: ToolName }
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
    const since = lastActivityAt ?? (activeTask.startedAt ? Date.parse(activeTask.startedAt) : now);
    const quietSec = (now - since) / 1000;
    if (quietSec > DEFAULTS.stuckAfterSec) return { kind: 'stuck', quietSec };
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

/** Which station each tool is performed at. */
export const TOOL_STATION: Record<ToolName, StationId> = {
  calculator: 'register',
  current_time: 'clock',
  notes_read: 'archive',
  notes_write: 'archive',
  read_file: 'bookcase',
  list_files: 'bookcase',
};

export const TOOL_LABEL: Record<ToolName, string> = {
  calculator: 'Crunching numbers',
  current_time: 'Checking the clock',
  notes_read: 'Reading the archive',
  notes_write: 'Filing a note',
  read_file: 'Reading a file',
  list_files: 'Browsing the shelves',
};

export function activityLabel(a: Activity): string {
  switch (a.kind) {
    case 'idle':
      return 'Idle';
    case 'thinking':
      return a.step > 1 ? `Thinking (step ${a.step})` : 'Thinking';
    case 'tool':
      return TOOL_LABEL[a.tool];
    case 'stuck':
      return `No activity for ${Math.floor(a.quietSec)}s`;
    case 'done':
      return 'Order up!';
    case 'failed':
      return 'Hit a problem';
  }
}
