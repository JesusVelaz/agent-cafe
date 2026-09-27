/**
 * Core domain types shared by the orchestrator (server) and the café (web).
 * These are wire DTOs: dates are ISO strings so they survive JSON/SSE unchanged.
 */

/** LLM vendors. Each one gets its own café floor. Add new providers here first. */
export const PROVIDER_IDS = ['openai', 'anthropic'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** live = real API calls, mock = scripted demo runs, off = refuses new tasks. */
export type ProviderMode = 'live' | 'mock' | 'off';

export type TaskStatus =
  | 'queued'
  | 'running'
  | 'tool_wait'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';

export const TERMINAL_STATUSES: readonly TaskStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'interrupted',
];

export const isTerminal = (s: TaskStatus): boolean => TERMINAL_STATUSES.includes(s);
export const isActive = (s: TaskStatus): boolean => s === 'running' || s === 'tool_wait';

/** Why a task failed. Drives the error copy and the café's failure animation. */
export type FailureKind =
  | 'provider_error'
  | 'budget'
  | 'daily_cap'
  | 'max_steps'
  | 'refusal';

/** Built-in, sandboxed tools. Each one maps to a café station (see web/src/sim). */
export const TOOL_NAMES = [
  'notes_read',
  'notes_write',
  'calculator',
  'current_time',
  'read_file',
  'list_files',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export interface AgentDTO {
  id: string;
  name: string;
  providerId: ProviderId;
  model: string;
  systemPrompt: string;
  /** Deterministic seed for sprite colours, so an agent always looks the same. */
  spriteSeed: number;
  createdAt: string;
  archivedAt: string | null;
}

export interface TaskDTO {
  id: string;
  agentId: string;
  providerId: ProviderId;
  model: string;
  prompt: string;
  status: TaskStatus;
  /** True when the task ran (or will run) against the mock provider. */
  isMock: boolean;
  maxCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** null when the model has no known price. */
  costUsd: number | null;
  steps: number;
  output: string | null;
  error: string | null;
  failureKind: FailureKind | null;
  retryOf: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ProviderStatusDTO {
  id: ProviderId;
  mode: ProviderMode;
  hasKey: boolean;
  /** Where the active key comes from. `.env` wins over a key stored via the UI. */
  keySource: 'env' | 'stored' | null;
  /** Masked hint such as `sk-…a1b2`. The key itself never leaves the server. */
  keyHint: string | null;
  dailyCapUsd: number;
  /** Live (non-mock) spend since local midnight. */
  spentTodayUsd: number;
  /** True when live spend has reached the daily cap: "Closed for today". */
  closed: boolean;
}

export interface SettingsDTO {
  /** Idle mock agents pick up canned tasks by themselves. Never touches live providers. */
  ambient: boolean;
}

export const DEFAULTS = {
  maxCostUsd: 0.5,
  dailyCapUsd: 5,
  maxSteps: 8,
  /** Seconds without an event before a running agent is shown as stuck (zzz). */
  stuckAfterSec: 60,
} as const;
