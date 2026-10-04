import type { CanUseTool, Options, SDKRateLimitInfo, query } from '@anthropic-ai/claude-agent-sdk';
import type { TaskEventData } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
import { claudePlanUsage, planUsageFromClaude, planUsageFromClaudeUsage, runClaudeTask, summarizeToolInput, type ApprovalAsk, type ClaudeRunContext } from './claude.js';

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
    return Object.assign(gen(), {
      close: () => {},
      supportedCommands: async () => [
        { name: 'review', description: 'Review changes', argumentHint: '[focus]', builtin: true },
        { name: 'frontend-design', description: 'Design a frontend', argumentHint: '' },
      ],
    });
  }) as unknown as typeof query;
  return { q, calls };
}

const assistant = (id: string, content: unknown[]) => ({
  type: 'assistant', parent_tool_use_id: null, uuid: 'u', session_id: 's',
  message: { id, content, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 7 } },
});

async function run(script: Parameters<typeof fakeQuery>[0], decision: 'allow' | 'deny' = 'allow', extra: Partial<ClaudeRunContext> = {}) {
  const { q, calls } = fakeQuery(script);
  const events: TaskEventData[] = [];
  const asks: ApprovalAsk[] = [];
  const limits: unknown[] = [];
  const sessions: string[] = [];
  const outcome = await runClaudeTask({
    ...extra,
    onSession: (id) => sessions.push(id),
    task: extra.task ?? { prompt: 'fix the bug', model: 'sonnet' },
    agent: { systemPrompt: 'Be tidy.', workDir: '/work', permission: 'ask' },
    executable: '/bin/claude',
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    approve: async (ask) => (asks.push(ask), decision),
    onUsage: (u) => limits.push(u),
    query: q,
  });
  return { outcome, events, asks, limits, sessions, options: calls[0]! };
}

describe('runClaudeTask', () => {
  it('implements /skills from Claude Code discovery without spending a model turn', async () => {
    const { outcome, events, sessions, options } = await run([], 'allow', { task: { prompt: '/skills', model: 'sonnet' } });
    expect(outcome).toMatchObject({
      status: 'completed',
      output: expect.stringMatching(/\/review.*Review changes[\s\S]*\/frontend-design.*Design a frontend/),
      totals: { steps: 0, inputTokens: 0, outputTokens: 0 },
    });
    expect(events).toEqual([]);
    expect(sessions).toEqual([]);
    expect(options).toMatchObject({ cwd: '/work', persistSession: false });
  });

  it('adds only the Café tools to allowedTools and leaves file/command approvals in place', async () => {
    const { options, asks } = await run([{ ask: ['Bash', { command: 'npm test' }] }, { type: 'result', subtype: 'success', is_error: false, result: 'ok' }], 'deny', {
      collaboration: { call: async () => [] },
    });
    expect(options.mcpServers?.cafe).toMatchObject({ type: 'sdk', name: 'cafe' });
    expect(Object.keys(options.mcpServers!)).toEqual(['cafe']);
    expect(options).toMatchObject({ strictMcpConfig: true, settings: { disableClaudeAiConnectors: true } });
    expect(options.allowedTools).toEqual(['mcp__cafe__cafe_list_agents', 'mcp__cafe__cafe_send_message', 'mcp__cafe__cafe_delegate_task', 'mcp__cafe__cafe_get_task']);
    expect(asks).toEqual([{ tool: 'Bash', summary: 'npm test', reason: null }]);
  });
  it('runs in the agent folder with its model and no API key', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    const { options } = await run([{ type: 'result', subtype: 'success', is_error: false, result: 'ok', num_turns: 1 }]);
    delete process.env.ANTHROPIC_API_KEY;
    expect(options).toMatchObject({ cwd: '/work', model: 'sonnet', permissionMode: 'default', pathToClaudeCodeExecutable: '/bin/claude', persistSession: true });
    expect(options.resume).toBeUndefined();
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Be tidy.' });
    expect(options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(options).toMatchObject({ strictMcpConfig: true, mcpServers: {}, settings: { disableClaudeAiConnectors: true } });
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
    expect(limits).toEqual([{ status: 'allowed', window: 'five_hour', utilization: 0.3, resetsAt: null }]);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      'model.start', 'model.delta', 'status', 'tool.start', 'tool.end', 'status', 'model.end', 'model.start', 'model.end',
    ]);
    expect(events.find((e) => e.kind === 'tool.end')).toMatchObject({ tool: 'Bash', ok: true, output: 'allow' });
  });

  it('resumes an earlier session and reports the new one once', async () => {
    const { options, sessions } = await run(
      [
        { type: 'system', subtype: 'init', session_id: 'sess-2' },
        assistant('m1', [{ type: 'text', text: 'Hi again' }]),
        { type: 'result', subtype: 'success', is_error: false, result: 'Hi again', num_turns: 1, session_id: 'sess-2' },
      ],
      'allow',
      { resume: 'sess-1' },
    );
    expect(options.resume).toBe('sess-1');
    expect(options).toMatchObject({ strictMcpConfig: true, settings: { disableClaudeAiConnectors: true } });
    expect(sessions).toEqual(['sess-2']);
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

describe('Claude plan usage', () => {
  it('reads the 5-hour window from a live rate-limit event (as Claude Code 2.1 sends it)', () => {
    // Captured from a real run: no top-level utilization, the windows sit in unifiedWindows (0..1).
    const info = {
      status: 'allowed',
      resetsAt: 1790833800,
      rateLimitType: 'five_hour',
      unifiedWindows: { five_hour: { utilization: 0.77, resetsAt: 1790833800 }, seven_day: { utilization: 0.48, resetsAt: 1791079200 } },
    } as unknown as SDKRateLimitInfo;
    expect(planUsageFromClaude(info)).toEqual({ status: 'allowed', window: 'five_hour', utilization: 0.77, resetsAt: new Date(1790833800 * 1000).toISOString() });
  });

  it('falls back to the top-level fields older CLIs send', () => {
    const info = { status: 'allowed_warning', rateLimitType: 'seven_day', utilization: 0.9, resetsAt: 1791079200 } as SDKRateLimitInfo;
    expect(planUsageFromClaude(info)).toEqual({ status: 'allowed_warning', window: 'seven_day', utilization: 0.9, resetsAt: new Date(1791079200 * 1000).toISOString() });
    expect(planUsageFromClaude({ status: 'allowed' } as SDKRateLimitInfo)).toEqual({ status: 'allowed', window: null, utilization: null, resetsAt: null });
  });

  it('reads the 5-hour window from the /usage data (percent, ISO time)', () => {
    const reply = {
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: 77, resets_at: '2026-10-01T05:50:00.056978+00:00' }, seven_day: { utilization: 48, resets_at: '2026-10-04T02:00:00Z' } },
    };
    expect(planUsageFromClaudeUsage(reply)).toEqual({ status: 'allowed', window: 'five_hour', utilization: 0.77, resetsAt: '2026-10-01T05:50:00.056Z' });
    expect(planUsageFromClaudeUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 100, resets_at: null } } })).toMatchObject({ status: 'rejected', utilization: 1 });
    expect(planUsageFromClaudeUsage({ rate_limits_available: false, rate_limits: null })).toBeNull();
    expect(planUsageFromClaudeUsage({ rate_limits_available: true, rate_limits: { five_hour: null } })).toBeNull();
    expect(planUsageFromClaudeUsage(null)).toBeNull();
  });

  it('asks a prompt-less session for usage, and gives up quietly when the API is gone', async () => {
    const session = (method: unknown) => {
      const closed: boolean[] = [];
      const calls: Options[] = [];
      const q = ((params: { prompt: AsyncIterable<unknown>; options: Options }) => {
        calls.push(params.options);
        void params.prompt[Symbol.asyncIterator]().next(); // the prompt never yields
        return { close: () => closed.push(true), usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: method };
      }) as unknown as typeof query;
      return { q, closed, calls };
    };
    const ok = session(async (o: unknown) => ({ seen: o, rate_limits_available: true, rate_limits: { five_hour: { utilization: 12, resets_at: null } } }));
    expect(await claudePlanUsage('/bin/claude', ok.q)).toMatchObject({ window: 'five_hour', utilization: 0.12 });
    expect(ok.closed).toEqual([true]);
    expect(ok.calls[0]).toMatchObject({ strictMcpConfig: true, mcpServers: {}, settings: { disableClaudeAiConnectors: true }, persistSession: false });

    const gone = session(undefined); // renamed or removed in a later SDK
    expect(await claudePlanUsage('/bin/claude', gone.q)).toBeNull();
    expect(gone.closed).toEqual([true]);

    const broken = session(async () => Promise.reject(new Error('usage endpoint 500')));
    expect(await claudePlanUsage('/bin/claude', broken.q)).toBeNull();
  });
});
