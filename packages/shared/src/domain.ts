/**
 * Core domain types shared by the orchestrator (server) and the café (web).
 * These are wire DTOs: dates are ISO strings so they survive JSON/SSE unchanged.
 */

/** LLM vendors. Each one gets its own café floor. Add new providers here first. */
export const PROVIDER_IDS = ['openai', 'anthropic'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** live = runs on the floor's harness, mock = scripted demo runs, off = refuses new tasks. */
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
  | 'max_steps'
  | 'refusal'
  /** The plan's usage limit was hit. */
  | 'usage_limit'
  /** The harness isn't signed in (or installed). */
  | 'signed_out';

/**
 * The vendor agent that runs a floor's live tasks, signed in with the user's own
 * subscription. Agents Café never sees credentials; see docs/specs/…-subscription-harnesses.md.
 */
export type HarnessId = 'claude-code' | 'codex';
export const HARNESS: Record<ProviderId, {
  id: HarnessId;
  /** The coding agent that runs the floor. */
  name: string;
  /** The account you connect it with. */
  account: string;
  login: string;
  /** Agents Café can run live tasks on it. */
  live: boolean;
}> = {
  anthropic: { id: 'claude-code', name: 'Claude Code', account: 'Claude', login: 'claude auth login', live: true },
  openai: { id: 'codex', name: 'Codex', account: 'ChatGPT', login: 'codex login', live: true },
};

/** How much an agent may do without asking. Commands always ask unless the harness allows them. */
export type AgentPermission = 'ask' | 'acceptEdits';

/** Built-in, sandboxed tools used by demo runs. Harness tools (Read, Bash…) are plain strings. */
export const TOOL_NAMES = [
  'notes_read',
  'notes_write',
  'calculator',
  'current_time',
  'read_file',
  'list_files',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** A folder agents can work in, added once and picked by name (like a checkout). */
export interface ProjectDTO {
  id: string;
  name: string;
  /** Absolute folder path. */
  path: string;
  createdAt: string;
}

export interface AgentDTO {
  id: string;
  name: string;
  providerId: ProviderId;
  /** The model this agent used last: the composer's default for them. */
  model: string;
  systemPrompt: string;
  /** Deterministic seed for sprite colours, so an agent always looks the same. */
  spriteSeed: number;
  /** The project this agent worked in last: the composer's default for them. */
  projectId: string | null;
  /** The permission this agent used last. */
  permission: AgentPermission;
  createdAt: string;
  archivedAt: string | null;
}

/** A harness asking the user before it acts (a command, an edit…). */
export interface ApprovalDTO {
  id: string;
  /** Harness tool name, e.g. Bash, Edit, WebFetch. */
  tool: string;
  /** One line: the command, the file, the URL. */
  summary: string;
  /** Why the harness asked, when it says. */
  reason: string | null;
  requestedAt: string;
}

export interface ExchangeMetadata {
  senderName: string;
  senderProviderId: ProviderId;
  /** Status of the delegated task whose result this carries. */
  status?: TaskStatus;
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
  /** Project the task runs in (required for live runs). */
  projectId: string | null;
  permission: AgentPermission;
  /** The earlier task whose conversation this one continues. */
  continueOf: string | null;
  /** The harness's session id, once known; follow-ups resume it. */
  sessionId: string | null;
  /** Cross-agent provenance. Optional for older clients and stored snapshots. */
  sourceTaskId?: string | null;
  exchangeKind?: 'message' | 'delegation' | 'result' | null;
  exchange?: ExchangeMetadata | null;
  rootTaskId?: string | null;
  exchangeDepth?: number;
  resultForTaskId?: string | null;
  /** Set while the harness waits for the user to allow or deny an action. */
  pendingApproval: ApprovalDTO | null;
  /** Thread settings, set on a thread's first task only. Optional for older snapshots. */
  threadTitle?: string | null;
  threadPinnedAt?: string | null;
  threadArchivedAt?: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type HarnessState = 'checking' | 'ready' | 'signed_out' | 'not_installed' | 'unsupported' | 'error';

export interface HarnessConnectionDTO {
  state: HarnessState;
  version: string | null;
  /** Signed-in account (email), when the harness reports it. */
  account: string | null;
  /** Subscription plan, e.g. "max". */
  plan: string | null;
  /** What to tell the user when not ready. */
  message: string | null;
  checkedAt: string | null;
}

/** The plan's current rate-limit window, as last reported by the harness. */
export interface PlanUsageDTO {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  /** e.g. five_hour, seven_day. */
  window: string | null;
  /** 0..1 when known. */
  utilization: number | null;
  resetsAt: string | null;
}

export interface ProviderStatusDTO {
  id: ProviderId;
  mode: ProviderMode;
  harness: HarnessId;
  connection: HarnessConnectionDTO;
  usage: PlanUsageDTO | null;
  /** Live tasks can run: the harness is supported and signed in. */
  liveAvailable: boolean;
  /** True when the plan's usage limit is reached: "Limit reached". */
  closed: boolean;
}

/** A model the harness offers (value is what the agent stores). */
export interface HarnessModelDTO {
  value: string;
  label: string;
  description: string;
  /** e.g. "Default", "Most capable". */
  tag?: string;
  /** The full model id an alias resolves to (harness aliases only). */
  resolved?: string;
}

/** A command the selected live harness can run from the composer. */
export interface HarnessCommandDTO {
  /** Stable command name without its leading slash or dollar sign. */
  name: string;
  /** Exact text inserted into the composer, e.g. `/review` or `$imagegen`. */
  invocation: string;
  description: string;
  argumentHint: string;
  aliases?: string[];
  /** Catalog is Agents Café's `/skills`; the other kinds come from the harness. */
  kind: 'catalog' | 'command' | 'skill';
}

export const DEFAULTS = {
  /** Demo runs only: simulated budget per task. */
  maxCostUsd: 0.5,
  maxSteps: 8,
  /** Live harness runs: model round-trips per task. */
  maxTurns: 60,
  /** Seconds without an event before a running agent is shown as stuck (zzz). */
  stuckAfterSec: 60,
} as const;
