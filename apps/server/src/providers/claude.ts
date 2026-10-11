/**
 * Runs one task on Claude Code through the Agent SDK, using the user's installed,
 * signed-in `claude` (their subscription). Translates the SDK's message stream into
 * café task events, and Claude Code's permission prompts into approvals the user
 * answers in the café.
 */
import {
  query as sdkQuery,
  type CanUseTool,
  type Options,
  type SDKMessage,
  type SDKRateLimitInfo,
} from '@anthropic-ai/claude-agent-sdk';
import { DEFAULTS, type FailureKind, type HarnessCommandDTO, type PlanUsageDTO } from '@agent-cafe/shared';
import type { RunOutcome, RunResult, RunTotals } from '../orchestrator/runner.js';
import { harnessEnv } from './live.js';
import { epochToIso, formatCommandCatalog, type LiveRunContext } from './live.js';
import { claudeCollaborationServer } from './collaborationTools.js';
import { collaborationSpecs } from '../orchestrator/collaboration.js';

export type { ApprovalAsk } from './live.js';

export interface ClaudeRunContext extends LiveRunContext {
  maxTurns?: number;
  /** Injected in tests. */
  query?: typeof sdkQuery;
}

/** Café sessions expose only explicitly supplied MCP tools, not personal integrations. */
export function claudeSessionOptions(executable: string) {
  return {
    pathToClaudeCodeExecutable: executable,
    env: harnessEnv(),
    strictMcpConfig: true,
    mcpServers: {},
    // Cloud connectors have a separate auto-discovery path from local MCP configs.
    settings: { disableClaudeAiConnectors: true },
  } satisfies Options;
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/**
 * Claude Code's rate-limit event as the café's plan usage. Claude Code 2.1 puts the
 * per-window numbers in `unifiedWindows` (0..1, not in the SDK's types) and leaves the
 * top-level `utilization` unset; older CLIs set only the top-level fields.
 */
export function planUsageFromClaude(info: SDKRateLimitInfo): PlanUsageDTO {
  const fiveHour = obj(obj((info as unknown as Obj).unifiedWindows)?.five_hour);
  const util = num(fiveHour?.utilization);
  if (util !== null) {
    return { status: info.status, window: 'five_hour', utilization: util, resetsAt: epochToIso(num(fiveHour!.resetsAt)) };
  }
  return {
    status: info.status,
    window: info.rateLimitType ?? null,
    utilization: info.utilization ?? null,
    resetsAt: epochToIso(info.resetsAt),
  };
}

/**
 * The 5-hour window from the data behind Claude Code's /usage (utilization 0..100,
 * ISO reset time). It has no status of its own: a full window reads as rejected.
 */
export function planUsageFromClaudeUsage(reply: unknown): PlanUsageDTO | null {
  const r = obj(reply);
  if (r?.rate_limits_available !== true) return null;
  const w = obj(obj(r.rate_limits)?.five_hour);
  const pct = num(w?.utilization);
  if (pct === null) return null;
  const resets = typeof w!.resets_at === 'string' ? new Date(w!.resets_at) : null;
  return {
    status: pct >= 100 ? 'rejected' : 'allowed',
    window: 'five_hour',
    utilization: Math.min(1, Math.max(0, pct / 100)),
    resetsAt: resets && !Number.isNaN(resets.getTime()) ? resets.toISOString() : null,
  };
}

/** The SDK's /usage call. Experimental and expected to be renamed, so it's looked up, never assumed. */
const USAGE_METHOD = 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET';
const USAGE_TIMEOUT_MS = 20_000;

/**
 * The plan's 5-hour window, read through a session that never sends a prompt (as the
 * model list is). Null when the SDK no longer offers the call, or it fails: the bar then
 * waits for a live run's rate-limit event instead.
 */
export async function claudePlanUsage(executable: string, query: typeof sdkQuery = sdkQuery): Promise<PlanUsageDTO | null> {
  let hold!: () => void;
  const idle = new Promise<void>((r) => (hold = r));
  async function* noPrompt(): AsyncGenerator<never> {
    await idle;
  }
  const q = query({ prompt: noPrompt(), options: { ...claudeSessionOptions(executable), persistSession: false } });
  let timer: NodeJS.Timeout | undefined;
  try {
    const call = (q as unknown as Obj)[USAGE_METHOD];
    if (typeof call !== 'function') return null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), USAGE_TIMEOUT_MS);
      timer.unref?.();
    });
    return planUsageFromClaudeUsage(await Promise.race([call.call(q, { skipBehaviors: true }), timeout]));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    hold();
    q.close();
  }
}

/** Commands and skills Claude Code discovers for one project folder. */
export async function claudeCommands(
  executable: string,
  cwd: string,
  query: typeof sdkQuery = sdkQuery,
): Promise<HarnessCommandDTO[]> {
  let hold!: () => void;
  const idle = new Promise<void>((resolve) => (hold = resolve));
  async function* noPrompt(): AsyncGenerator<never> {
    await idle;
  }
  const q = query({
    prompt: noPrompt(),
    options: { ...claudeSessionOptions(executable), cwd, persistSession: false },
  });
  try {
    const commands = await q.supportedCommands();
    return commands
      .filter((command) => command.name.trim())
      .map((command) => ({
        name: command.name,
        invocation: `/${command.name}`,
        description: command.description,
        argumentHint: command.argumentHint,
        ...(command.aliases?.length ? { aliases: command.aliases } : {}),
        kind: command.builtin ? 'command' as const : 'skill' as const,
      }));
  } finally {
    hold();
    q.close();
  }
}

const MAX_TOOL_OUTPUT_CHARS = 16_000;
const NO_QUESTIONS =
  'You are running unattended in Agents Café and cannot ask questions. Make a sensible choice, say what you assumed, and continue.';

/** What a tool call will do, in full: the command, file or URL, else its whole input. */
export function toolInputLine(input: Record<string, unknown>): string {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : null);
  return s('command') ?? s('file_path') ?? s('notebook_path') ?? s('url') ?? s('pattern') ?? s('path') ?? s('query') ?? JSON.stringify(input);
}

/** One line describing what a tool call will do. */
export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  const text = toolInputLine(input);
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

  if (task.prompt.trim().toLowerCase() === '/skills') {
    try {
      const commands = await claudeCommands(ctx.executable, agent.workDir, ctx.query ?? sdkQuery);
      return done({ status: 'completed', output: formatCommandCatalog('Claude Code', commands) });
    } catch (err) {
      return done({ status: 'failed', failureKind: 'provider_error', error: err instanceof Error ? err.message : String(err) });
    }
  }

  const ac = new AbortController();
  const onAbort = () => ac.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  const canUseTool: CanUseTool = async (toolName, input, opts) => {
    if (toolName === 'AskUserQuestion') return { behavior: 'deny', message: NO_QUESTIONS };
    const decision = await ctx.approve(
      { tool: toolName, summary: summarizeToolInput(toolName, input), reason: opts.title ?? opts.decisionReason ?? null, match: toolInputLine(input) },
      opts.signal,
    );
    return decision === 'allow'
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: 'The user declined this action. Try another approach, or explain what you need and stop.' };
  };

  const q = (ctx.query ?? sdkQuery)({
    prompt: task.prompt,
    options: {
      ...claudeSessionOptions(ctx.executable),
      cwd: agent.workDir,
      ...(ctx.collaboration ? {
        mcpServers: { cafe: claudeCollaborationServer(ctx.collaboration) },
        allowedTools: collaborationSpecs.map((s) => `mcp__cafe__${s.name}`),
      } : {}),
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
        ctx.onUsage(planUsageFromClaude(m.rate_limit_info));
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
