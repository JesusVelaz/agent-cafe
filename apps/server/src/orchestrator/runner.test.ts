import type { TaskEventData } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import type { ToolRegistry } from '../tools/registry.js';
import {
  AdapterError,
  sleep,
  type ProviderAdapter,
  type ToolCall,
  type TurnRequest,
  type TurnResult,
} from '../providers/types.js';
import { runTask, type RunContext } from './runner.js';

type Step = Partial<TurnResult> | Error;

/** Adapter that replays a fixed script of turns and records each request. */
function scripted(steps: Step[] | ((i: number) => Step)): ProviderAdapter & { requests: TurnRequest[] } {
  const requests: TurnRequest[] = [];
  return {
    kind: 'mock',
    requests,
    async testConnection() {
      return { ok: true, message: '' };
    },
    async runTurn(req, signal, onDelta) {
      requests.push(structuredClone(req));
      const i = requests.length - 1;
      const s = typeof steps === 'function' ? steps(i) : steps[i];
      if (!s) throw new Error(`no scripted step ${i}`);
      if (s instanceof Error) throw s;
      await sleep(0, signal);
      const text = s.text ?? '';
      if (text) onDelta(text);
      const toolCalls = s.toolCalls ?? [];
      return {
        text,
        toolCalls,
        usage: s.usage ?? { inputTokens: 100, outputTokens: 50 },
        stop: s.stop ?? (toolCalls.length ? 'tool_use' : 'end'),
      };
    },
  };
}

const call = (name: ToolCall['name'], input = {}): ToolCall => ({ id: `c_${name}`, name, input });

const fakeTools: ToolRegistry = {
  specs: [],
  async execute(name) {
    if (name === 'read_file') return { ok: false, output: 'Not found: x' };
    return { ok: true, output: `${name} result` };
  },
};

function ctx(adapter: ProviderAdapter, over: Partial<RunContext> = {}) {
  const events: TaskEventData[] = [];
  const c: RunContext = {
    task: { prompt: 'do the thing', model: 'claude-sonnet-5', maxCostUsd: 0.5 },
    agent: { systemPrompt: 'sys' },
    adapter,
    tools: fakeTools,
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    ...over,
  };
  return { c, events };
}

const kinds = (events: TaskEventData[]) =>
  events.filter((e) => e.kind !== 'model.delta' && e.kind !== 'log').map((e) => (e.kind === 'status' ? `status:${e.status}` : e.kind));

describe('runTask', () => {
  it('runs a tool loop to completion with the expected event order', async () => {
    const adapter = scripted([{ text: 'checking', toolCalls: [call('calculator', { expression: '1+1' })] }, { text: 'It is 2.' }]);
    const { c, events } = ctx(adapter);
    const out = await runTask(c);

    expect(out).toMatchObject({ status: 'completed', output: 'It is 2.' });
    expect(out.totals).toMatchObject({ inputTokens: 200, outputTokens: 100, steps: 2 });
    // sonnet-5: (200*2 + 100*10)/1e6
    expect(out.totals.costUsd).toBeCloseTo(0.0014, 10);
    expect(kinds(events)).toEqual([
      'model.start', 'model.end',
      'status:tool_wait', 'tool.start', 'tool.end', 'status:running',
      'model.start', 'model.end',
    ]);
    // The tool result was fed back to the model.
    const second = adapter.requests[1]!;
    expect(second.messages.at(-1)).toEqual({
      role: 'tool',
      results: [{ callId: 'c_calculator', name: 'calculator', output: 'calculator result', isError: false }],
    });
  });

  it('feeds tool errors back to the model and keeps going', async () => {
    const adapter = scripted([{ toolCalls: [call('read_file', { path: 'x' })] }, { text: 'no such file' }]);
    const { c } = ctx(adapter);
    const out = await runTask(c);
    expect(out.status).toBe('completed');
    const toolMsg = adapter.requests[1]!.messages.at(-1);
    expect(toolMsg).toMatchObject({ role: 'tool', results: [{ isError: true }] });
  });

  it('fails with max_steps when the model never stops calling tools', async () => {
    const adapter = scripted(() => ({ toolCalls: [call('current_time')] }));
    const { c } = ctx(adapter, { maxSteps: 8 });
    const out = await runTask(c);
    expect(out).toMatchObject({ status: 'failed', failureKind: 'max_steps' });
    expect(adapter.requests).toHaveLength(8);
  });

  it('refuses to start a call the budget cannot cover', async () => {
    const adapter = scripted([{ text: 'hi' }]);
    const { c } = ctx(adapter, { task: { prompt: 'x', model: 'claude-fable-5-1', maxCostUsd: 0.000001 } });
    const out = await runTask(c);
    expect(out).toMatchObject({ status: 'failed', failureKind: 'budget' });
    expect(adapter.requests).toHaveLength(0);
  });

  it('caps max output tokens by the remaining budget', async () => {
    const adapter = scripted([{ text: 'hi' }]);
    // $0.01 on sonnet-5 ($10/MTok out) affords < 1000 output tokens.
    const { c } = ctx(adapter, { task: { prompt: 'x', model: 'claude-sonnet-5', maxCostUsd: 0.01 } });
    await runTask(c);
    expect(adapter.requests[0]!.maxOutputTokens).toBeLessThan(1000);
    expect(adapter.requests[0]!.maxOutputTokens).toBeGreaterThan(256);
  });

  it('stops mid-run once spend reaches the cap', async () => {
    const adapter = scripted(() => ({ toolCalls: [call('current_time')], usage: { inputTokens: 1000, outputTokens: 400 } }));
    // sonnet-5: each turn costs 0.002 + 0.004 = $0.006
    const { c } = ctx(adapter, { task: { prompt: 'x', model: 'claude-sonnet-5', maxCostUsd: 0.013 } });
    const out = await runTask(c);
    expect(out).toMatchObject({ status: 'failed', failureKind: 'budget' });
    expect(out.totals.costUsd!).toBeLessThanOrEqual(0.013);
  });

  it('reports provider errors', async () => {
    const adapter = scripted([new AdapterError('rate limited')]);
    const { c } = ctx(adapter);
    expect(await runTask(c)).toMatchObject({ status: 'failed', failureKind: 'provider_error', error: 'rate limited' });
  });

  it('reports refusals', async () => {
    const adapter = scripted([{ text: '', stop: 'refusal' }]);
    const { c } = ctx(adapter);
    expect(await runTask(c)).toMatchObject({ status: 'failed', failureKind: 'refusal' });
  });

  it('cancels when aborted', async () => {
    const ctrl = new AbortController();
    const adapter = scripted(() => {
      ctrl.abort();
      return { toolCalls: [call('current_time')] };
    });
    const { c } = ctx(adapter, { signal: ctrl.signal });
    expect((await runTask(c)).status).toBe('cancelled');
  });

  it('runs models without a price, with a warning', async () => {
    const adapter = scripted([{ text: 'ok' }]);
    const { c, events } = ctx(adapter, { task: { prompt: 'x', model: 'my-custom-model', maxCostUsd: 0.5 } });
    const out = await runTask(c);
    expect(out).toMatchObject({ status: 'completed' });
    expect(out.totals.costUsd).toBeNull();
    expect(events.some((e) => e.kind === 'log' && e.level === 'warn')).toBe(true);
  });
});
