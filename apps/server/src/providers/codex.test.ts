import type { PlanUsageDTO, TaskEventData } from '@agent-cafe/shared';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FakeCodexServer } from '../test/fakeCodex.js';
import { codexModels, parseCodexVersion, planUsageFromCodex, runCodexTask, versionAtLeast, type CodexRunContext } from './codex.js';
import type { ApprovalAsk } from './live.js';

const WORK = process.platform === 'win32' ? 'C:\\work\\shop' : '/work/shop';
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

/** Runs a task against `srv`; `turn` scripts what Codex does once the turn starts. */
async function run(
  srv: FakeCodexServer,
  opts: {
    turn?: (s: FakeCodexServer) => void | Promise<void>;
    decide?: (ask: ApprovalAsk, signal: AbortSignal) => Promise<'allow' | 'deny'>;
    ctx?: Partial<CodexRunContext>;
  } = {},
) {
  srv.on('turn/start', () => {
    if (opts.turn) setImmediate(() => void opts.turn!(srv));
    return { turn: { id: 'turn_1', items: [], status: 'inProgress', error: null } };
  });
  const events: TaskEventData[] = [];
  const asks: ApprovalAsk[] = [];
  const usage: PlanUsageDTO[] = [];
  const sessions: string[] = [];
  const outcome = await runCodexTask({
    task: { prompt: 'fix the bug', model: 'gpt-6-astra' },
    agent: { systemPrompt: 'Be tidy.', workDir: WORK, permission: 'ask' },
    executable: 'C:\\Codex\\codex.exe',
    signal: new AbortController().signal,
    emit: (e) => events.push(e),
    approve: async (ask, signal) => (asks.push(ask), opts.decide ? opts.decide(ask, signal) : 'allow'),
    onUsage: (u) => usage.push(u),
    onSession: (id) => sessions.push(id),
    spawn: srv.spawn,
    interruptGraceMs: 200,
    ...opts.ctx,
  });
  return { outcome, events, asks, usage, sessions };
}

const item = (s: FakeCodexServer, phase: 'started' | 'completed', it: Record<string, unknown>) =>
  s.notify(`item/${phase}`, { threadId: 'thr_new', turnId: 'turn_1', item: it });
const usageNote = (s: FakeCodexServer, total: [number, number], last: [number, number], threadId = 'thr_new') =>
  s.notify('thread/tokenUsage/updated', {
    threadId,
    turnId: 'turn_1',
    tokenUsage: {
      total: { totalTokens: 0, inputTokens: total[0], cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: total[1], reasoningOutputTokens: 0 },
      last: { totalTokens: 0, inputTokens: last[0], cachedInputTokens: 0, cacheWriteInputTokens: 0, outputTokens: last[1], reasoningOutputTokens: 0 },
      modelContextWindow: null,
    },
  });

describe('runCodexTask', () => {
  it('starts app-server, then a thread in the project under the café’s approval and sandbox policy', async () => {
    const srv = new FakeCodexServer();
    const { outcome, sessions } = await run(srv, { turn: (s) => s.completeTurn('completed') });
    expect(srv.spawns).toEqual([{ exe: 'C:\\Codex\\codex.exe', args: ['app-server'] }]);
    expect(srv.received[0]).toMatchObject({ method: 'initialize', params: { clientInfo: { name: 'agent_cafe' }, capabilities: null } });
    expect(srv.received[1]).toEqual({ method: 'initialized' });
    expect(srv.requests('thread/start')[0]!.params).toEqual({
      cwd: WORK,
      approvalPolicy: 'untrusted',
      sandbox: 'workspace-write',
      approvalsReviewer: 'user',
      config: { sandbox_workspace_write: { network_access: false, writable_roots: [] } },
      developerInstructions: 'Be tidy.',
      model: 'gpt-6-astra',
    });
    expect(srv.requests('turn/start')[0]!.params).toEqual({ threadId: 'thr_new', input: [{ type: 'text', text: 'fix the bug', text_elements: [] }] });
    expect(sessions).toEqual(['thr_new']);
    expect(outcome.status).toBe('completed');
    expect(srv.killed).toBe(false); // closed by ending stdin
  });

  it('translates streaming text, tools and token usage into café events', async () => {
    const srv = new FakeCodexServer();
    const { outcome, events } = await run(srv, {
      turn: async (s) => {
        item(s, 'started', { type: 'agentMessage', id: 'm1', text: '' });
        s.notify('item/agentMessage/delta', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'm1', delta: 'Looking ' });
        s.notify('item/agentMessage/delta', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'm1', delta: 'around.' });
        item(s, 'completed', { type: 'agentMessage', id: 'm1', text: 'Looking around.' });
        usageNote(s, [1200, 40], [1200, 40]);
        item(s, 'started', { type: 'commandExecution', id: 'c1', command: 'npm test', cwd: WORK, status: 'inProgress' });
        item(s, 'completed', { type: 'commandExecution', id: 'c1', command: 'npm test', cwd: WORK, status: 'completed', exitCode: 1, aggregatedOutput: '1 failing' });
        item(s, 'completed', { type: 'fileChange', id: 'f1', status: 'completed', changes: [{ path: 'src/a.ts', kind: { type: 'update' }, diff: '-a\n+b' }] });
        item(s, 'started', { type: 'agentMessage', id: 'm2', text: '' });
        item(s, 'completed', { type: 'agentMessage', id: 'm2', text: 'Fixed it.' });
        usageNote(s, [2600, 90], [1400, 50]);
        await tick();
        s.completeTurn('completed');
      },
    });
    expect(outcome).toMatchObject({ status: 'completed', output: 'Fixed it.', totals: { steps: 2, inputTokens: 2600, outputTokens: 90, costUsd: null } });
    expect(events.filter((e) => e.kind === 'model.delta').map((e) => (e as { text: string }).text)).toEqual(['Looking ', 'around.']);
    expect(events.filter((e) => e.kind === 'model.end')).toEqual([
      { kind: 'model.end', step: 1, text: 'Looking around.', inputTokens: 1200, outputTokens: 40, costUsd: null },
      { kind: 'model.end', step: 2, text: 'Fixed it.', inputTokens: 1400, outputTokens: 50, costUsd: null },
    ]);
    const tools = events.filter((e) => e.kind === 'tool.start' || e.kind === 'tool.end');
    expect(tools).toEqual([
      { kind: 'tool.start', step: 1, callId: 'c1', tool: 'shell', input: { command: 'npm test', cwd: WORK } },
      { kind: 'tool.end', step: 1, callId: 'c1', tool: 'shell', ok: false, output: '1 failing' },
      { kind: 'tool.start', step: 1, callId: 'f1', tool: 'apply_patch', input: { files: ['src/a.ts'] } },
      { kind: 'tool.end', step: 1, callId: 'f1', tool: 'apply_patch', ok: true, output: '-a\n+b' },
    ]);
    expect(events.filter((e) => e.kind === 'status').map((e) => (e as { status: string }).status)).toEqual(['tool_wait', 'running', 'tool_wait', 'running']);
  });

  it('only reports success when the turn completes successfully', async () => {
    const srv = new FakeCodexServer();
    const failed = await run(srv, {
      turn: (s) => {
        item(s, 'completed', { type: 'agentMessage', id: 'm1', text: 'Partial answer' });
        s.completeTurn('failed', { message: 'You have hit your usage limit.', codexErrorInfo: 'usageLimitExceeded' });
      },
    });
    expect(failed.outcome).toMatchObject({ status: 'failed', failureKind: 'usage_limit', error: 'You have hit your usage limit.' });

    const srv2 = new FakeCodexServer();
    const authFail = await run(srv2, { turn: (s) => s.completeTurn('failed', { message: 'Unauthorized', codexErrorInfo: 'unauthorized' }) });
    expect(authFail.outcome).toMatchObject({ status: 'failed', failureKind: 'signed_out' });
  });

  it('passes command approvals to the user and returns their decision to the right request', async () => {
    const srv = new FakeCodexServer();
    const replies: unknown[] = [];
    const { asks, outcome } = await run(srv, {
      decide: async (a) => (a.summary === 'rm -rf build' ? 'deny' : 'allow'),
      turn: async (s) => {
        const [a, b] = await Promise.all([
          s.request('item/commandExecution/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'c1', kind: 'command', command: 'npm install', reason: 'needs network' }),
          s.request('item/commandExecution/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'c2', kind: 'command', command: 'rm -rf build', reason: null }),
        ]);
        replies.push(a.result, b.result);
        s.completeTurn('completed');
      },
    });
    expect(asks).toEqual([
      { tool: 'shell', summary: 'npm install', reason: 'needs network' },
      { tool: 'shell', summary: 'rm -rf build', reason: null },
    ]);
    expect(replies).toEqual([{ decision: 'accept' }, { decision: 'decline' }]);
    expect(outcome.status).toBe('completed');
  });

  it('auto-accepts in-project edits under "Auto-accept edits", but still asks for commands and outside files', async () => {
    const srv = new FakeCodexServer();
    const replies: unknown[] = [];
    const outside = process.platform === 'win32' ? 'C:\\Windows\\hosts' : '/etc/hosts';
    const { asks, events } = await run(srv, {
      ctx: { agent: { systemPrompt: '', workDir: WORK, permission: 'acceptEdits' } },
      decide: async () => 'deny',
      turn: async (s) => {
        item(s, 'started', { type: 'fileChange', id: 'f1', status: 'inProgress', changes: [{ path: 'src/a.ts', diff: '' }] });
        item(s, 'started', { type: 'fileChange', id: 'f2', status: 'inProgress', changes: [{ path: outside, diff: '' }] });
        await tick();
        replies.push((await s.request('item/fileChange/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'f1', reason: null, grantRoot: null })).result);
        replies.push((await s.request('item/fileChange/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'f2', reason: null, grantRoot: null })).result);
        replies.push((await s.request('item/commandExecution/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'c1', kind: 'command', command: 'ls' })).result);
        s.completeTurn('completed');
      },
    });
    expect(replies).toEqual([{ decision: 'accept' }, { decision: 'decline' }, { decision: 'decline' }]);
    expect(asks.map((a) => a.tool)).toEqual(['apply_patch', 'shell']);
    expect(events).toContainEqual({ kind: 'log', level: 'info', message: 'Auto-accepted edit (Auto-accept edits): src/a.ts' });
  });

  it('asks for every edit under "Ask first"', async () => {
    const srv = new FakeCodexServer();
    const { asks } = await run(srv, {
      turn: async (s) => {
        item(s, 'started', { type: 'fileChange', id: 'f1', status: 'inProgress', changes: [{ path: 'src/a.ts', diff: '' }] });
        await tick();
        await s.request('item/fileChange/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'f1', reason: null, grantRoot: null });
        s.completeTurn('completed');
      },
    });
    expect(asks).toEqual([{ tool: 'apply_patch', summary: 'src/a.ts', reason: null }]);
  });

  it('resumes the earlier thread for a follow-up and counts only this task’s tokens', async () => {
    const srv = new FakeCodexServer();
    const { outcome, sessions } = await run(srv, {
      ctx: { resume: 'thr_old' },
      turn: async (s) => {
        s.notify('item/completed', { threadId: 'thr_old', turnId: 'turn_1', item: { type: 'agentMessage', id: 'm1', text: 'Done again.' } });
        usageNote(s, [9000, 500], [1000, 20], 'thr_old'); // the thread already had 8000/480 from before
        s.notify('turn/completed', { threadId: 'thr_old', turn: { id: 'turn_1', status: 'completed', error: null, items: [] } });
      },
    });
    expect(srv.requests('thread/start')).toEqual([]);
    expect(srv.requests('thread/resume')[0]!.params).toMatchObject({ threadId: 'thr_old', excludeTurns: true, approvalPolicy: 'untrusted', sandbox: 'workspace-write' });
    expect(sessions).toEqual(['thr_old']);
    expect(outcome).toMatchObject({ status: 'completed', output: 'Done again.', totals: { inputTokens: 1000, outputTokens: 20 } });
  });

  it('fails clearly when an old thread can’t be resumed', async () => {
    const srv = new FakeCodexServer().on('thread/resume', () => {
      throw new Error('thread not found: thr_gone');
    });
    const { outcome } = await run(srv, { ctx: { resume: 'thr_gone' } });
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/Couldn't reopen this Codex conversation/) });
    expect(srv.requests('turn/start')).toEqual([]);
  });

  it('cancels: interrupts the turn, cancels a pending approval, and ends as cancelled', async () => {
    const srv = new FakeCodexServer();
    const ac = new AbortController();
    let approvalReply: unknown;
    let approveSignal: AbortSignal | undefined;
    const { outcome, events } = await run(srv, {
      ctx: { signal: ac.signal },
      decide: (_a, signal) =>
        new Promise((resolve) => {
          approveSignal = signal;
          signal.addEventListener('abort', () => resolve('deny'));
        }),
      turn: async (s) => {
        item(s, 'started', { type: 'commandExecution', id: 'c1', command: 'npm run build', cwd: WORK, status: 'inProgress' });
        const pending = s.request('item/commandExecution/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'c1', kind: 'command', command: 'npm run build' });
        await tick(10);
        ac.abort();
        approvalReply = (await pending).result;
      },
    });
    expect(outcome.status).toBe('cancelled');
    expect(srv.requests('turn/interrupt')[0]!.params).toEqual({ threadId: 'thr_new', turnId: 'turn_1' });
    expect(approveSignal?.aborted).toBe(true);
    expect(approvalReply).toEqual({ decision: 'cancel' });
    expect(events).toContainEqual({ kind: 'tool.end', step: 0, callId: 'c1', tool: 'shell', ok: false, output: 'Stopped.' });
  });

  it('kills Codex if it ignores the interrupt', async () => {
    const srv = new FakeCodexServer().on('turn/interrupt', () => ({}));
    const ac = new AbortController();
    const { outcome } = await run(srv, {
      ctx: { signal: ac.signal },
      turn: () => void setTimeout(() => ac.abort(), 5),
    });
    expect(outcome.status).toBe('cancelled');
  });

  it('fails with Codex’s own words when the process dies mid-turn, and releases a pending approval', async () => {
    const srv = new FakeCodexServer();
    let approveSignal: AbortSignal | undefined;
    const { outcome } = await run(srv, {
      decide: (_a, signal) => new Promise((resolve) => ((approveSignal = signal), signal.addEventListener('abort', () => resolve('deny')))),
      turn: async (s) => {
        void s.request('item/commandExecution/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'c1', kind: 'command', command: 'make' });
        await tick();
        s.stderr('ERROR codex_core: stream disconnected');
        await tick();
        s.exit(1);
      },
    });
    expect(outcome).toMatchObject({ status: 'failed', failureKind: 'provider_error', error: expect.stringMatching(/exited with code 1: ERROR codex_core: stream disconnected/) });
    expect(approveSignal?.aborted).toBe(true);
  });

  it('refuses to run if Codex reports a looser policy than asked for', async () => {
    const srv = new FakeCodexServer().on('thread/start', (p) => ({ thread: { id: 'thr_new' }, approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' }, cwd: p.cwd }));
    const { outcome, sessions } = await run(srv);
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/didn't apply Agent Café's approval and sandbox settings/) });
    expect(srv.requests('turn/start')).toEqual([]);
    expect(sessions).toEqual([]);
  });

  it('pins the sandbox against inherited config, and refuses any looser effective policy', async () => {
    const outside = process.platform === 'win32' ? 'C:\\' : '/';
    const sandbox = { type: 'workspaceWrite', writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };
    const reply = (over: Record<string, unknown>) => (p: Record<string, unknown>) => ({ thread: { id: 'thr_new' }, approvalPolicy: 'untrusted', approvalsReviewer: 'user', cwd: p.cwd, sandbox, ...over });
    const looser: Array<[string, Record<string, unknown>, RegExp]> = [
      ['network on (e.g. from config.toml)', { sandbox: { ...sandbox, networkAccess: true } }, /network/],
      ['a writable root outside the project', { sandbox: { ...sandbox, writableRoots: [outside] } }, /writable/],
      ['an automatic approval reviewer', { approvalsReviewer: 'auto_review' }, /auto_review/],
      ['a different working folder', { cwd: outside }, /folder/],
    ];
    for (const [what, over, why] of looser) {
      const srv = new FakeCodexServer().on('thread/start', reply(over));
      const { outcome } = await run(srv);
      expect(outcome, what).toMatchObject({ status: 'failed', error: expect.stringMatching(why) });
      expect(srv.requests('turn/start'), what).toEqual([]);
    }

    // What's sent pins network off and no extra writable roots, whatever config.toml says.
    const ok = new FakeCodexServer();
    const inside = await run(ok.on('thread/start', reply({ sandbox: { ...sandbox, writableRoots: [WORK] } })), { turn: (s) => s.completeTurn('completed') });
    expect(inside.outcome.status).toBe('completed');
    expect(ok.requests('thread/start')[0]!.params).toMatchObject({
      approvalsReviewer: 'user',
      config: { sandbox_workspace_write: { network_access: false, writable_roots: [] } },
    });
  });

  it('asks before an "Auto-accept edits" patch that moves a file out of the project', async () => {
    const srv = new FakeCodexServer();
    const outside = process.platform === 'win32' ? 'C:\\Users\\Public\\stolen.ts' : '/tmp/stolen.ts';
    const replies: unknown[] = [];
    const { asks } = await run(srv, {
      ctx: { agent: { systemPrompt: '', workDir: WORK, permission: 'acceptEdits' } },
      decide: async () => 'deny',
      turn: async (s) => {
        item(s, 'started', { type: 'fileChange', id: 'f1', status: 'inProgress', changes: [{ path: 'src/a.ts', kind: { type: 'update', move_path: outside }, diff: '' }] });
        item(s, 'started', { type: 'fileChange', id: 'f2', status: 'inProgress', changes: [{ path: 'src/b.ts', kind: { type: 'update', move_path: 'src/c.ts' }, diff: '' }] });
        await tick();
        replies.push((await s.request('item/fileChange/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'f1', reason: null, grantRoot: null })).result);
        replies.push((await s.request('item/fileChange/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'f2', reason: null, grantRoot: null })).result);
        s.completeTurn('completed');
      },
    });
    expect(replies).toEqual([{ decision: 'decline' }, { decision: 'accept' }]); // the in-project rename is still auto-accepted
    expect(asks).toEqual([{ tool: 'apply_patch', summary: `src/a.ts → ${outside}`, reason: null }]);
  });

  it('asks before editing through a junction outside the project, including new files', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'cafe-patch-paths-'));
    const project = join(temp, 'project');
    const outside = join(temp, 'outside');
    mkdirSync(project);
    mkdirSync(outside);
    symlinkSync(outside, join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const srv = new FakeCodexServer();
      const replies: unknown[] = [];
      const { asks } = await run(srv, {
        ctx: { agent: { systemPrompt: '', workDir: project, permission: 'acceptEdits' } },
        decide: async () => 'deny',
        turn: async (s) => {
          for (const [id, path] of [['escape', 'linked/new/a.ts'], ['local', 'src/new/a.ts']]) {
            item(s, 'started', { type: 'fileChange', id, status: 'inProgress', changes: [{ path, kind: { type: 'add' }, diff: '' }] });
            replies.push((await s.request('item/fileChange/requestApproval', { threadId: 'thr_new', turnId: 'turn_1', itemId: id, grantRoot: null })).result);
          }
          s.completeTurn('completed');
        },
      });
      expect(replies).toEqual([{ decision: 'decline' }, { decision: 'accept' }]);
      expect(asks.map((a) => a.summary)).toEqual(['linked/new/a.ts']);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });

  it('does not start a turn when cancelled while the thread is being set up', async () => {
    const ac = new AbortController();
    const srv = new FakeCodexServer();
    srv.on('thread/start', async (p) => {
      ac.abort(); // the user cancels while Codex is opening the thread
      await tick();
      return { thread: { id: 'thr_new' }, approvalPolicy: p.approvalPolicy, approvalsReviewer: 'user', cwd: p.cwd, sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } };
    });
    const { outcome } = await run(srv, { ctx: { signal: ac.signal } });
    expect(outcome.status).toBe('cancelled');
    expect(srv.requests('turn/start')).toEqual([]);
  });

  it('checks the account, model, version and Windows sandbox before starting', async () => {
    const tooOld = await run(new FakeCodexServer({ version: '0.120.3' }));
    expect(tooOld.outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/needs Codex 0\.154\.0 or newer .*0\.120\.3/) });

    const apiKey = await run(new FakeCodexServer({ account: { type: 'apiKey' } }));
    expect(apiKey.outcome).toMatchObject({ status: 'failed', failureKind: 'signed_out', error: expect.stringMatching(/API key/) });

    const signedOut = new FakeCodexServer().on('account/read', () => ({ account: null, requiresOpenaiAuth: true }));
    expect((await run(signedOut)).outcome).toMatchObject({ status: 'failed', failureKind: 'signed_out' });

    const noModel = await run(new FakeCodexServer(), { ctx: { task: { prompt: 'x', model: 'gpt-6-sol' } } });
    expect(noModel.outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/gpt-6-sol isn’t available .*GPT-6-Astra, GPT-5\.6-Luna/) });

    if (process.platform === 'win32') {
      const srv = new FakeCodexServer({ sandbox: 'notConfigured' });
      const r = await run(srv);
      expect(r.outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/Windows sandbox isn't set up \(notConfigured\)/) });
      expect(srv.requests('thread/start')).toEqual([]);
    }
  });

  it('turns unsupported methods into an update hint', async () => {
    const srv = new FakeCodexServer();
    srv.on('turn/start', () => {
      throw new Error('Invalid request: unknown variant `turn/start`');
    });
    const outcome = await runCodexTask({
      task: { prompt: 'x', model: 'default' },
      agent: { systemPrompt: '', workDir: WORK, permission: 'ask' },
      executable: 'codex',
      signal: new AbortController().signal,
      emit: () => {},
      approve: async () => 'allow',
      onUsage: () => {},
      spawn: srv.spawn,
    });
    expect(outcome).toMatchObject({ status: 'failed', error: expect.stringMatching(/doesn't support turn\/start\. Run `codex update`/) });
  });

  it('answers questions and unknown server requests without hanging', async () => {
    const srv = new FakeCodexServer();
    const replies: unknown[] = [];
    await run(srv, {
      turn: async (s) => {
        replies.push(
          (await s.request('item/tool/requestUserInput', { threadId: 'thr_new', turnId: 'turn_1', itemId: 'q', isBlocking: true, questions: [{ id: 'q1', header: 'Pick', question: 'A or B?' }] })).result,
        );
        replies.push((await s.request('mcpServer/elicitation/request', { threadId: 'thr_new' })).result);
        replies.push((await s.request('item/tool/call', { threadId: 'thr_new' })).error);
        s.completeTurn('completed');
      },
    });
    expect(replies[0]).toEqual({ answers: { q1: { answers: [expect.stringMatching(/unattended/)] } } });
    expect(replies[1]).toEqual({ action: 'decline', content: null, _meta: null });
    expect(replies[2]).toMatchObject({ code: -32601 });
  });

  it('reports plan usage from rate-limit updates, never as a cost', async () => {
    const srv = new FakeCodexServer();
    const { usage, outcome } = await run(srv, {
      turn: (s) => {
        s.notify('account/rateLimits/updated', {
          rateLimits: { limitId: 'codex', primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1790844268 }, secondary: { usedPercent: 7, windowDurationMins: 10080, resetsAt: 1791142340 }, rateLimitReachedType: null },
        });
        s.completeTurn('completed');
      },
    });
    expect(usage).toEqual([{ status: 'allowed', window: 'five_hour', utilization: 0.42, resetsAt: new Date(1790844268 * 1000).toISOString() }]);
    expect(outcome.totals.costUsd).toBeNull();
  });

  it('runs two tasks at once without cross-talk, and ignores another thread’s traffic', async () => {
    const opened = (id: string) => (p: Record<string, unknown>) => ({
      thread: { id },
      approvalPolicy: p.approvalPolicy,
      approvalsReviewer: 'user',
      cwd: p.cwd,
      sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false },
    });
    const a = new FakeCodexServer().on('thread/start', opened('thr_a'));
    const b = new FakeCodexServer().on('thread/start', opened('thr_b'));
    const say = (s: FakeCodexServer, thread: string, text: string) =>
      s.notify('item/completed', { threadId: thread, turnId: 'turn_1', item: { type: 'agentMessage', id: `${thread}-m`, text } });
    const [ra, rb] = await Promise.all([
      run(a, {
        decide: async (ask) => (ask.summary === 'echo a' ? 'allow' : 'deny'),
        turn: async (s) => {
          say(s, 'thr_b', 'stray message for b'); // not this task's thread
          await s.request('item/commandExecution/requestApproval', { threadId: 'thr_a', turnId: 'turn_1', itemId: 'c', command: 'echo a' });
          say(s, 'thr_a', 'answer A');
          await tick(15);
          s.completeTurn('completed', null, 'thr_a');
        },
      }),
      run(b, {
        decide: async (ask) => (ask.summary === 'echo b' ? 'allow' : 'deny'),
        turn: async (s) => {
          await s.request('item/commandExecution/requestApproval', { threadId: 'thr_b', turnId: 'turn_1', itemId: 'c', command: 'echo b' });
          say(s, 'thr_b', 'answer B');
          s.completeTurn('completed', null, 'thr_b');
        },
      }),
    ]);
    expect(ra.outcome).toMatchObject({ status: 'completed', output: 'answer A' });
    expect(rb.outcome).toMatchObject({ status: 'completed', output: 'answer B' });
    expect(ra.asks.map((x) => x.summary)).toEqual(['echo a']);
    expect(rb.asks.map((x) => x.summary)).toEqual(['echo b']);
    expect(ra.sessions).toEqual(['thr_a']);
    expect(rb.sessions).toEqual(['thr_b']);
  });
});

describe('Codex helpers', () => {
  it('reads versions and compares them', () => {
    expect(parseCodexVersion('codex-cli 0.154.0')).toBe('0.154.0');
    expect(parseCodexVersion('agent_cafe/0.160.2 (Windows 10.0.26200; x86_64)')).toBe('0.160.2');
    expect(versionAtLeast('0.154.0', '0.154.0')).toBe(true);
    expect(versionAtLeast('0.160.0', '0.154.0')).toBe(true);
    expect(versionAtLeast('1.0.0', '0.154.0')).toBe(true);
    expect(versionAtLeast('0.99.9', '0.154.0')).toBe(false);
  });

  it('maps rate limits to the busiest window, and a reached limit to rejected', () => {
    expect(
      planUsageFromCodex({
        rateLimitsByLimitId: { codex: { primary: { usedPercent: 9, windowDurationMins: 300, resetsAt: 1 }, secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: 2 }, rateLimitReachedType: 'rateLimitReached' } },
      }),
    ).toEqual({ status: 'rejected', window: 'seven_day', utilization: 1, resetsAt: new Date(2000).toISOString() });
    expect(planUsageFromCodex({ rateLimits: { primary: null, secondary: null } })).toBeNull();
    expect(planUsageFromCodex(null)).toBeNull();
  });

  it('lists visible models and tags the default', async () => {
    const srv = new FakeCodexServer({
      models: [
        { id: 'a', model: 'gpt-a', displayName: 'GPT-A', description: 'x', hidden: false, isDefault: true },
        { id: 'h', model: 'gpt-hidden', displayName: 'Hidden', description: '', hidden: true, isDefault: false },
      ],
    });
    expect(await codexModels('codex', srv.spawn)).toEqual([{ value: 'gpt-a', label: 'GPT-A', description: 'x', tag: 'Default' }]);
  });
});
