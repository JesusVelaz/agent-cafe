/**
 * The agent tool loop: model turn → run requested tools → feed results back → repeat,
 * until the model answers, a guard trips (steps, budget) or the task is cancelled.
 *
 * Pure orchestration: it knows nothing about the database or the café. Everything
 * observable goes out through `emit`, which the Orchestrator persists and broadcasts.
 */
import { DEFAULTS, findModel, type FailureKind, type TaskEventData } from '@agent-cafe/shared';
import type { ToolRegistry } from '../tools/registry.js';
import {
  isAbortError,
  type NeutralMessage,
  type ProviderAdapter,
  type ToolResultMessage,
} from '../providers/types.js';

export interface RunContext {
  task: { prompt: string; model: string; maxCostUsd: number };
  agent: { systemPrompt: string };
  adapter: ProviderAdapter;
  tools: ToolRegistry;
  signal: AbortSignal;
  emit: (event: TaskEventData) => void;
  maxSteps?: number;
}

export interface RunTotals {
  inputTokens: number;
  outputTokens: number;
  /** null when the model has no known price. */
  costUsd: number | null;
  steps: number;
}

export type RunResult =
  | { status: 'completed'; output: string }
  | { status: 'failed'; failureKind: FailureKind; error: string }
  | { status: 'cancelled' };

export type RunOutcome = RunResult & { totals: RunTotals };

/** Ceiling for a single model response; keeps non-streaming SDK calls well under timeouts. */
const MAX_OUTPUT_PER_TURN = 8192;
/** Below this many affordable output tokens, a turn isn't worth starting. */
const MIN_USEFUL_OUTPUT = 256;
/** Tool output kept in the conversation history (the event log keeps a copy too). */
const MAX_TOOL_OUTPUT_CHARS = 16_000;

const approxTokens = (s: string) => Math.ceil(s.length / 4);

export async function runTask(ctx: RunContext): Promise<RunOutcome> {
  const { task, agent, adapter, tools, signal, emit } = ctx;
  const maxSteps = ctx.maxSteps ?? DEFAULTS.maxSteps;
  const price = findModel(task.model);

  const totals: RunTotals = { inputTokens: 0, outputTokens: 0, costUsd: price ? 0 : null, steps: 0 };
  const messages: NeutralMessage[] = [{ role: 'user', content: task.prompt }];
  const done = (r: RunResult): RunOutcome => ({ ...r, totals });

  if (!price) {
    emit({
      kind: 'log',
      level: 'warn',
      message: `No price known for "${task.model}". Cost and the per-task budget can't be enforced.`,
    });
  }

  // Rough size of what the next turn sends, used to reserve input cost before calling.
  let pendingInputTokens = approxTokens(agent.systemPrompt + task.prompt + JSON.stringify(tools.specs));

  try {
    for (let step = 1; step <= maxSteps; step++) {
      if (signal.aborted) return done({ status: 'cancelled' });

      // ── Budget guard: bound this turn's output by what's left of the budget. ──
      let maxOutputTokens = MAX_OUTPUT_PER_TURN;
      if (price) {
        const remaining = task.maxCostUsd - (totals.costUsd ?? 0);
        const inputCost = (pendingInputTokens * price.inputPerMTok) / 1e6;
        const affordable = Math.floor(((remaining - inputCost) * 1e6) / price.outputPerMTok);
        maxOutputTokens = Math.min(MAX_OUTPUT_PER_TURN, affordable);
        if (maxOutputTokens < MIN_USEFUL_OUTPUT) {
          return done({
            status: 'failed',
            failureKind: 'budget',
            error: `Budget reached: $${(totals.costUsd ?? 0).toFixed(4)} of $${task.maxCostUsd.toFixed(2)} spent, not enough left for step ${step}.`,
          });
        }
      }

      // ── Model turn ──
      emit({ kind: 'model.start', step, maxOutputTokens });
      const turn = await adapter.runTurn(
        { model: task.model, system: agent.systemPrompt, messages, tools: tools.specs, maxOutputTokens },
        signal,
        (text) => emit({ kind: 'model.delta', step, text }),
      );
      const turnCost = price
        ? (turn.usage.inputTokens * price.inputPerMTok + turn.usage.outputTokens * price.outputPerMTok) / 1e6
        : null;
      totals.steps = step;
      totals.inputTokens += turn.usage.inputTokens;
      totals.outputTokens += turn.usage.outputTokens;
      if (turnCost !== null) totals.costUsd = (totals.costUsd ?? 0) + turnCost;
      emit({
        kind: 'model.end',
        step,
        text: turn.text,
        inputTokens: turn.usage.inputTokens,
        outputTokens: turn.usage.outputTokens,
        costUsd: turnCost,
      });

      if (turn.stop === 'refusal') {
        return done({ status: 'failed', failureKind: 'refusal', error: 'The model declined this request.' });
      }
      if (turn.toolCalls.length === 0) {
        if (turn.stop === 'max_tokens') {
          emit({ kind: 'log', level: 'warn', message: 'Answer was cut off by the output token limit.' });
        }
        return done({ status: 'completed', output: turn.text });
      }

      messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls, raw: turn.raw });
      if (step === maxSteps) break; // don't run tools whose results nobody will read

      // ── Tools (sequential: one station at a time reads better in the café) ──
      emit({ kind: 'status', status: 'tool_wait' });
      const results: ToolResultMessage[] = [];
      for (const call of turn.toolCalls) {
        if (signal.aborted) return done({ status: 'cancelled' });
        emit({ kind: 'tool.start', step, callId: call.id, tool: call.name, input: call.input });
        const res = await tools.execute(call.name, call.input);
        emit({ kind: 'tool.end', step, callId: call.id, tool: call.name, ok: res.ok, output: res.output });
        results.push({
          callId: call.id,
          name: call.name,
          output: res.output.slice(0, MAX_TOOL_OUTPUT_CHARS),
          isError: !res.ok,
        });
      }
      messages.push({ role: 'tool', results });
      emit({ kind: 'status', status: 'running' });

      // Next turn resends the history plus what was just added.
      pendingInputTokens =
        turn.usage.inputTokens + turn.usage.outputTokens + approxTokens(JSON.stringify(results));
    }

    return done({
      status: 'failed',
      failureKind: 'max_steps',
      error: `Stopped after ${maxSteps} steps without a final answer.`,
    });
  } catch (err) {
    if (isAbortError(err) || signal.aborted) return done({ status: 'cancelled' });
    return done({
      status: 'failed',
      failureKind: 'provider_error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
