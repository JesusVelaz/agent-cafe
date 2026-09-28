/**
 * Runs one task on Claude Code through the Agent SDK, using the user's installed,
 * signed-in `claude` (their subscription). Translates the SDK's message stream into
 * café task events, and Claude Code's permission prompts into approvals the user
 * answers in the café.
 */
import {
  query as sdkQuery,
  type CanUseTool,
  type SDKMessage,
  type SDKRateLimitInfo,
} from '@anthropic-ai/claude-agent-sdk';
import { DEFAULTS, type AgentPermission, type FailureKind, type TaskEventData } from '@agent-cafe/shared';
import type { RunOutcome, RunResult, RunTotals } from '../orchestrator/runner.js';
import { harnessEnv } from './harness.js';

export interface ApprovalAsk {
  tool: string;
  summary: string;
  reason: string | null;
}

export interface ClaudeRunContext {
  task: { prompt: string; model: string };
  agent: { systemPrompt: string; workDir: string; permission: AgentPermission };
  executable: string;
  signal: AbortSignal;
  emit: (event: TaskEventData) => void;
  /** Resolves when the user answers (deny if the task is cancelled first). */
  approve: (ask: ApprovalAsk, signal: AbortSignal) => Promise<'allow' | 'deny'>;
  onRateLimit: (info: SDKRateLimitInfo) => void;
  /** Called once with the harness session id, so a follow-up can resume it. */
  onSession?: (sessionId: string) => void;
  /** Resume this earlier session (a follow-up message). */
  resume?: string;
  maxTurns?: number;
  /** Injected in tests. */
  query?: typeof sdkQuery;
}

const MAX_TOOL_OUTPUT_CHARS = 16_000;
const NO_QUESTIONS =
  'You are running unattended in Agent Café and cannot ask questions. Make a sensible choice, say what you assumed, and continue.';

/** One line describing what a tool call will do. */
export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
  const line = s('command') ?? s('file_path') ?? s('notebook_path') ?? s('url') ?? s('pattern') ?? s('path') ?? s('query');
  const text = line ?? JSON.stringify(input);
  return text.length > 300 ? `${text.slice(0, 297)}…` : text;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

export async function runClaudeTask(ctx: ClaudeRunContext): Promise<RunOutcome> {
  const { task, agent, signal, emit } = ctx;
  const totals: RunTotals = { inputTokens: 0, outputTokens: 0, costUsd: null, steps: 0 };
  const done = (r: RunResult): RunOutcome => ({ ...r, totals });

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (toolName === 'AskUserQuestion') return { behavior: 'deny', message: NO_QUESTIONS };
    const decision = await ctx.approve(
      { tool: toolName, summary: summarizeToolInput(toolName, input), reason: opts.title ?? opts.decisionReason ?? null },
      opts.signal,
    );
    return decision === 'allow'
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The user declined this action. Try another approach, or explain what you need and stop.' };
  };

  const q = (ctx.query ?? sdkQuery)({
    prompt: task.prompt,
    options: {
      pathToClaudeCodeExecutable: ctx.executable,
      env: harnessEnv(),
      cwd: agent.workDir,
      ...(task.model && task.model !== 'default' ? { model: task.model } : {}),
      permissionMode: agent.permission === 'acceptEdits' ? 'acceptEdits' : 'default',
      canUseTool,
      abortController: ac,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: agent.systemPrompt },
      includePartialMessages: true,
      // Sessions are kept (in Claude Code's own history) so follow-ups can resume them.
      persistSession: true,
      ...(ctx.resume ? { resume: ctx.resume } : {}),
      maxTurns: ctx.maxTurns ?? DEFAULTS.maxTurns,
    },
  });

  // A step is one assistant message (one model round-trip).
  let msgId: string | null = null;
  let stepText = '';
  let stepUsage = { input: 0, output: 0 };
  const toolNames = new Map<string, string>();
  let lastError: string | undefined;

  const endStep = () => {
    if (!msgId) return;
    emit({ kind: 'model.end', step: totals.steps, text: stepText, inputTokens: stepUsage.input, outputTokens: stepUsage.output, costUsd: null });
    totals.inputTokens += stepUsage.input;
    totals.outputTokens += stepUsage.output;
    msgId = null;
  };
  const beginStep = (id: string) => {
    if (id === msgId) return;
    endStep();
    totals.steps += 1;
    msgId = id;
    stepText = '';
    stepUsage = { input: 0, output: 0 };
    emit({ kind: 'model.start', step: totals.steps, maxOutputTokens: 0 });
  };

  try {
    let result: Extract<SDKMessage, { type: 'result' }> | null = null;
    let sessionSeen = false;
    for await (const m of q) {
      if (!sessionSeen && 'session_id' in m && typeof m.session_id === 'string' && m.session_id) {
        sessionSeen = true;
        ctx.onSession?.(m.session_id);
      }
      if (m.type === 'stream_event') {
        if (m.parent_tool_use_id) continue;
        const ev = m.event;
        if (ev.type === 'message_start') beginStep(ev.message.id);
        else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && msgId) {
          emit({ kind: 'model.delta', step: totals.steps, text: ev.delta.text });
        }
      } else if (m.type === 'assistant') {
        if (m.parent_tool_use_id) continue; // subagent traffic: its parent's Task call stands for it
        if (m.error) lastError = m.error;
        beginStep(m.message.id);
        const u = m.message.usage;
        if (u) {
          stepUsage = {
            input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
            output: u.output_tokens ?? 0,
          };
        }
        for (const block of m.message.content) {
          if (block.type === 'text') stepText += block.text;
          else if (block.type === 'tool_use') {
            toolNames.set(block.id, block.name);
            emit({ kind: 'status', status: 'tool_wait' });
            emit({ kind: 'tool.start', step: totals.steps, callId: block.id, tool: block.name, input: block.input });
          }
        }
      } else if (m.type === 'user') {
        if (m.parent_tool_use_id || typeof m.message.content === 'string') continue;
        for (const block of m.message.content) {
          if (block.type !== 'tool_result') continue;
          emit({
            kind: 'tool.end',
            step: totals.steps,
            callId: block.tool_use_id,
            tool: toolNames.get(block.tool_use_id) ?? 'tool',
            ok: !block.is_error,
            output: toolResultText(block.content).slice(0, MAX_TOOL_OUTPUT_CHARS),
          });
          emit({ kind: 'status', status: 'running' });
        }
      } else if (m.type === 'rate_limit_event') {
        ctx.onRateLimit(m.rate_limit_info);
      } else if (m.type === 'result') {
        result = m;
      }
    }
    endStep();

    if (signal.aborted) return done({ status: 'cancelled' });
    if (!result) return done({ status: 'failed', failureKind: 'provider_error', error: 'Claude Code stopped without a result.' });
    if (result.subtype === 'success' && !result.is_error) return done({ status: 'completed', output: result.result });
    if (result.subtype === 'success') {
      return done({ status: 'failed', failureKind: failureFor(lastError), error: result.result || 'Claude Code reported an error.' });
    }
    if (result.subtype === 'error_max_turns') {
      return done({ status: 'failed', failureKind: 'max_steps', error: `Stopped after ${result.num_turns} turns without finishing.` });
    }
    return done({
      status: 'failed',
      failureKind: failureFor(lastError),
      error: result.errors.join('; ') || 'Claude Code stopped with an error.',
    });
  } catch (err) {
    if (signal.aborted) return done({ status: 'cancelled' });
    return done({ status: 'failed', failureKind: 'provider_error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    signal.removeEventListener('abort', onAbort);
    q.close();
  }
}

function failureFor(error: string | undefined): FailureKind {
  if (error === 'authentication_failed' || error === 'oauth_org_not_allowed') return 'signed_out';
  if (error === 'rate_limit') return 'usage_limit';
  return 'provider_error';
}
