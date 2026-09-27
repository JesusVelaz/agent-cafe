import type {
  AgentDTO,
  ProviderStatusDTO,
  SettingsDTO,
  TaskDTO,
  TaskStatus,
  ToolName,
} from './domain';

/**
 * Per-task event log entries. The orchestration layer emits these; the simulation
 * layer reads them to decide where each agent walks and what it animates.
 * Phase 4's external ingest endpoint will accept this same shape.
 */
export type TaskEventData =
  | { kind: 'status'; status: TaskStatus; note?: string }
  | { kind: 'model.start'; step: number; maxOutputTokens: number }
  /** Streaming text. Broadcast live but never persisted (model.end carries the full text). */
  | { kind: 'model.delta'; step: number; text: string }
  | {
      kind: 'model.end';
      step: number;
      text: string;
      inputTokens: number;
      outputTokens: number;
      costUsd: number | null;
    }
  | { kind: 'tool.start'; step: number; callId: string; tool: ToolName; input: unknown }
  | { kind: 'tool.end'; step: number; callId: string; tool: ToolName; ok: boolean; output: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export type TaskEventKind = TaskEventData['kind'];

export type TaskEventDTO = TaskEventData & {
  /** Monotonic per task. Deltas use seq -1 because they aren't persisted. */
  seq: number;
  at: string;
};

/** Everything that flows over the SSE stream. */
export type CafeEvent =
  | {
      type: 'snapshot';
      agents: AgentDTO[];
      tasks: TaskDTO[];
      /** Latest persisted event per active task, so the scene can place agents on reconnect. */
      lastEvents: Record<string, TaskEventDTO>;
      providers: ProviderStatusDTO[];
      settings: SettingsDTO;
    }
  | { type: 'agent.upserted'; agent: AgentDTO }
  | { type: 'task.upserted'; task: TaskDTO }
  | { type: 'task.event'; taskId: string; agentId: string; event: TaskEventDTO }
  | { type: 'provider.updated'; provider: ProviderStatusDTO }
  | { type: 'settings.updated'; settings: SettingsDTO };
