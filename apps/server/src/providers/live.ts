/**
 * The contract every live harness runner meets (Claude Code, Codex): run one task
 * in the agent's project on the user's signed-in CLI, translate its activity into
 * café task events, and route its permission prompts through `approve`.
 */
import type { AgentPermission, HarnessCommandDTO, PlanUsageDTO, ProviderId, TaskEventData } from '@agent-cafe/shared';
import type { RunOutcome } from '../orchestrator/runner.js';
import type { CollaborationTools } from '../orchestrator/collaboration.js';

export interface ApprovalAsk {
  tool: string;
  summary: string;
  reason: string | null;
}

export interface LiveRunContext {
  task: { prompt: string; model: string };
  agent: { systemPrompt: string; workDir: string; permission: AgentPermission };
  executable: string;
  signal: AbortSignal;
  emit: (event: TaskEventData) => void;
  /** Resolves when the user answers (deny if the signal fires first). */
  approve: (ask: ApprovalAsk, signal: AbortSignal) => Promise<'allow' | 'deny'>;
  /** The plan's rate-limit window as the harness reports it. Never a cost. */
  onUsage: (usage: PlanUsageDTO) => void;
  /** Called with the harness's session (Claude) or thread (Codex) id, so a follow-up can resume it. */
  onSession?: (sessionId: string) => void;
  /** Resume this earlier session or thread (a follow-up message). */
  resume?: string;
  /** Scoped to this task by the server; harnesses cannot impersonate another sender. */
  collaboration?: CollaborationTools;
}

/** The child environment for harness processes: never an API key, so runs bill the user's plan. */
export function harnessEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-cafe/0.1.0' };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

/** Plain Markdown that reads well in either harness transcript. */
export function formatCommandCatalog(harness: string, commands: HarnessCommandDTO[]): string {
  const available = commands.filter((command) => command.kind !== 'catalog');
  if (!available.length) return `No ${harness} skills or commands are available in this project.`;
  return [
    `${harness} skills and commands available in this project:`,
    '',
    ...available.map((command) => `- \`${command.invocation}${command.argumentHint ? ` ${command.argumentHint}` : ''}\`${command.description ? ` — ${command.description}` : ''}`),
  ].join('\n');
}

export type LiveRunner = (ctx: LiveRunContext) => Promise<RunOutcome>;
export type LiveRunners = Record<ProviderId, LiveRunner>;

/** Epoch seconds (tolerating milliseconds) as an ISO string. */
export const epochToIso = (t: number | null | undefined): string | null =>
  typeof t === 'number' && Number.isFinite(t) && t > 0 ? new Date(t < 1e12 ? t * 1000 : t).toISOString() : null;
