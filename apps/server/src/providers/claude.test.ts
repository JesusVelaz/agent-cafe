import type { CanUseTool, Options, query } from '@anthropic-ai/claude-agent-sdk';
import type { TaskEventData } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { runClaudeTask, summarizeToolInput, type ApprovalAsk } from './claude.js';

type Msg = Record<string, unknown>;

/** A stand-in for the SDK's query(): replays a script, asking canUseTool where told. */
function fakeQuery(script: Array<Msg | { ask: [string, Record<string, unknown>] }>) {
  const calls: Options[] = [];
  const q = ((params: { options?: Options }) => {
    calls.push(params.options!);
    const canUseTool = params.options!.canUseTool as CanUseTool;
    async function* gen() {
      for (const step of script) {
        if ('ask' in step) {
          const [tool, input] = step.ask as [string, Record<string, unknown>];
          const r = await canUseTool(tool, input, { signal: new AbortController().signal, toolUseID: 'x', requestId: 'r' });
          yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', is_error: r?.behavior !== 'allow', content: [{ type: 'text', text: r?.behavior ?? 'none' }] }] } };
        } else yield step;
      }
    }
    return Object.assign(gen(), { close: () => {} });
  }) as unknown as typeof query;
  return { q, calls };
}

const assistant = (id: string, content: unknown[]) => ({
  type: 'assistant', parent_tool_use_id: null, uuid: 'u', session_id: 's',
  message: { id, content, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7 } },
});

async function run(script: Parameters<typeof fakeQuery>[0], decision: 'allow' | 'deny' = 'allow') {
  const { q, calls } = fakeQuery(script);
  const events: TaskEventData[] = [];
  const asks: ApprovalAsk[] = [];
  const limits: unknown[] = [];
  const outcome = await runClaudeTask({
    task: { prompt: 'fix the bug', model: 'sonnet' },
    agent: { systemPrompt: 'Be tidy.', workDir: '/work', permission: 'ask' },
    executable: '/bin/claude',
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    approve: async (ask) => (asks.push(ask), decision),
    onRateLimit: (i) => limits.push(i),
    query: q,
  });
  return { outcome, events, asks, limits, options: calls[0]! };
}

describe('runClaudeTask', () => {
  it('runs in the agent folder with its model and no API key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    const { options } = await run([{ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1 }]);
    delete process.env.ANTHROPIC_API_KEY;
    expect(options).toMatchObject({ cwd: '/work', model: 'sonnet', permissionMode: 'default', pathToClaudeCodeExecutable: '/bin/claude', persistSession: false });
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Be tidy.' });
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('turns the SDK stream into steps, tool events and a result', async () => {
    const { outcome, events, asks, limits } = await run([
      { type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Look' } } },
      assistant('m1', [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }]),
      { ask: ['Bash', { command: 'npm test' }] },
      { type: 'rate_limit_event', rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.3 } },
      assistant('m2', [{ type: 'text', text: 'Fixed.' }]),
      { type: 'result', subtype: 'success', is_error: false, result: 'Fixed.', num_turns: 2 },
    ]);
    expect(outcome).toMatchObject({ status: 'completed', output: 'Fixed.', totals: { steps: 2, inputTokens: 30, outputTokens: 14, costUsd: null } });
    expect(asks).toEqual([{ tool: 'Bash', summary: 'npm test', reason: null }]);
    expect(limits).toHaveLength(1);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      'model.start', 'model.delta', 'status', 'tool.start', 'tool.end', 'status', 'model.end', 'model.start', 'model.end',
    ]);
    expect(events.find((e) => e.kind === 'tool.end')).toMatchObject({ tool: 'Bash', ok: true, output: 'allow' });
  });

  it('tells Claude when the user declines', async () => {
    const { events } = await run(
      [{ ask: ['Edit', { file_path: '/work/a.ts' }] }, { type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1 }],
      'deny',
    );
    expect(events.find((e) => e.kind === 'tool.end')).toMatchObject({ ok: false });
  });

  it('maps failures', async () => {
    const turns = await run([{ type: 'result', subtype: 'error_max_turns', num_turns: 60, errors: [] }]);
    expect(turns.outcome).toMatchObject({ status: 'failed', failureKind: 'max_steps' });
    const auth = await run([
      { ...assistant('m1', [{ type: 'text', text: 'Not logged in' }]), error: 'authentication_failed' },
      { type: 'result', subtype: 'success', is_error: true, result: 'Not logged in', num_turns: 1 },
    ]);
    expect(auth.outcome).toMatchObject({ status: 'failed', failureKind: 'signed_out', error: 'Not logged in' });
  });

  it('summarizes tool inputs in one line', () => {
    expect(summarizeToolInput('Bash', { command: 'git status' })).toBe('git status');
    expect(summarizeToolInput('Write', { file_path: '/a/b.ts', content: 'x' })).toBe('/a/b.ts');
    expect(summarizeToolInput('Other', { a: 1 })).toBe('{"a":1}');
  });
});
