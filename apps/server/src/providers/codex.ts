/**
 * Runs one task on Codex through `codex app-server`, using the user's installed,
 * signed-in `codex` (their ChatGPT plan). Translates the app-server's thread and
 * item events into café task events, and its approval requests into approvals the
 * user answers in the café.
 *
 * Uses the stable app-server surface plus experimental dynamic tools for Café collaboration, verified against
 * Codex 0.154.0. To diff a newer CLI's protocol:
 *   codex app-server generate-ts --out <dir>          (stable)
 *   codex app-server generate-ts --experimental --out <dir>
 * The generated types describe that version only; every field read here is checked
 * at runtime, because the CLI on the user's machine may be a different version.
 *
 * Permissions (the café's setting → Codex):
 *   Both settings run with approvalPolicy "untrusted" and the "workspace-write"
 *   sandbox, with approvals reviewed by the user (never Codex's auto-reviewer):
 *   - Under "untrusted", Codex asks before every file patch and every command it
 *     doesn't already trust (its exec-policy rules may still allow known-safe ones).
 *   - Approved commands still run in the sandbox: they can write only inside the
 *     project (and temp folders, Codex's default), with no network. If one needs
 *     more, Codex asks again.
 *   - "Ask first" passes every request to the user.
 *   - "Auto-accept edits" answers file-patch requests itself when every file it
 *     writes, including move destinations, is inside the project (and logs that it
 *     did); commands and anything outside the project still go to the user.
 *   The sandbox settings are pinned in the thread's config, so config.toml can't
 *   widen them, and the effective policy Codex reports back is checked in full
 *   (policy, reviewer, sandbox type, network, writable roots, folder); if anything
 *   is looser, the task doesn't run.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import type { FailureKind, HarnessCommandDTO, HarnessModelDTO, PlanUsageDTO } from '@agent-cafe/shared';
import type { RunOutcome, RunResult, RunTotals } from '../orchestrator/runner.js';
import { CodexRpc, CodexRpcError, RpcReplyError, exitMessage, spawnCodex, type CodexRpcHandlers, type CodexSpawner } from './codexRpc.js';
import { epochToIso, formatCommandCatalog, type ApprovalAsk, type LiveRunContext } from './live.js';
import { codexCollaborationTools } from './collaborationTools.js';

/** The oldest Codex whose app-server this was verified against. */
export const CODEX_MIN_VERSION = '0.154.0';

export interface CodexRunContext extends LiveRunContext {
  /** Injected in tests. */
  spawn?: CodexSpawner;
  /** How long to wait for an interrupted turn to wind down before killing Codex. */
  interruptGraceMs?: number;
}

const MAX_TOOL_OUTPUT_CHARS = 16_000;
const NO_QUESTIONS =
  'You are running unattended in Agents Café and cannot ask questions. Make a sensible choice, say what you assumed, and continue.';
const THREAD_POLICY = { approvalPolicy: 'untrusted', sandbox: 'workspace-write', approvalsReviewer: 'user' } as const;
/**
 * Overrides for the user's config.toml, which could otherwise widen the sandbox
 * (network on, extra writable folders). Temp folders stay writable, as Codex's default.
 */
const SANDBOX_CONFIG = { sandbox_workspace_write: { network_access: false, writable_roots: [] } } as const;

// ── Runtime checks on what Codex sends ───────────────────────────────────────

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj | null => (typeof x === 'object' && x !== null && !Array.isArray(x) ? (x as Obj) : null);
const str = (x: unknown): string | null => (typeof x === 'string' ? x : null);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

class CodexProtocolError extends Error {}

function field(o: Obj | null, key: string, what: string): Obj {
  const v = obj(o?.[key]);
  if (!v) throw new CodexProtocolError(`Codex sent an unexpected ${what} (no ${key}).`);
  return v;
}
function idOf(o: Obj, what: string): string {
  const id = str(o.id);
  if (!id) throw new CodexProtocolError(`Codex sent an unexpected ${what} (no id).`);
  return id;
}

// ── Versions ─────────────────────────────────────────────────────────────────

/** "agent_cafe/0.154.0 (Windows …)" or "codex-cli 0.154.0" → "0.154.0". */
export function parseCodexVersion(s: string): string | null {
  return s.match(/(\d+\.\d+\.\d+)/)?.[1] ?? null;
}

export function versionAtLeast(v: string, min: string): boolean {
  const a = v.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

export const tooOldMessage = (v: string) =>
  `Agents Café needs Codex ${CODEX_MIN_VERSION} or newer to run tasks (you have ${v}). Run \`codex update\`, then try again.`;

// ── Sessions ─────────────────────────────────────────────────────────────────

/** Starts `codex app-server` and completes the initialize handshake. */
export async function openCodex(exe: string, handlers: CodexRpcHandlers = {}, spawn: CodexSpawner = spawnCodex, experimentalApi = false): Promise<CodexRpc> {
  const rpc = new CodexRpc(spawn(exe, ['app-server']), handlers);
  try {
    const init = obj(
      await rpc.request('initialize', { clientInfo: { name: 'agent_cafe', title: 'Agents Café', version: '0.1.0' }, capabilities: experimentalApi ? { experimentalApi: true } : null }, 20_000),
    );
    const version = parseCodexVersion(str(init?.userAgent) ?? '');
    if (version && !versionAtLeast(version, CODEX_MIN_VERSION)) throw new CodexProtocolError(tooOldMessage(version));
    rpc.notify('initialized');
    return rpc;
  } catch (err) {
    await rpc.close();
    throw err;
  }
}

/** A short-lived session for one question (models, limits). */
async function withCodex<T>(exe: string, fn: (rpc: CodexRpc) => Promise<T>, spawn?: CodexSpawner): Promise<T> {
  const rpc = await openCodex(exe, {}, spawn);
  try {
    return await fn(rpc);
  } finally {
    await rpc.close();
  }
}

async function listModels(rpc: CodexRpc): Promise<HarnessModelDTO[]> {
  const out: HarnessModelDTO[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const r = obj(await rpc.request('model/list', cursor ? { cursor } : {}));
    for (const m of Array.isArray(r?.data) ? r.data : []) {
      const o = obj(m);
      const value = str(o?.model) ?? str(o?.id);
      if (!o || !value || o.hidden === true) continue;
      out.push({ value, label: str(o.displayName) ?? value, description: str(o.description) ?? '', ...(o.isDefault === true ? { tag: 'Default' } : {}) });
    }
    cursor = str(r?.nextCursor);
    if (!cursor) break;
  }
  return out;
}

/** The models this ChatGPT account can use in Codex. */
export const codexModels = (exe: string, spawn?: CodexSpawner) => withCodex(exe, listModels, spawn);

interface CodexSkillCommand extends HarnessCommandDTO {
  path: string;
}

/** Enabled skills Codex discovers for one project folder. */
async function listSkills(rpc: CodexRpc, cwd: string): Promise<CodexSkillCommand[]> {
  const reply = obj(await rpc.request('skills/list', { cwds: [cwd] }));
  const entry = (Array.isArray(reply?.data) ? reply.data : []).map(obj).find((candidate) => candidate && str(candidate.cwd) === cwd)
    ?? (Array.isArray(reply?.data) ? obj(reply.data[0]) : null);
  const out: CodexSkillCommand[] = [];
  for (const raw of Array.isArray(entry?.skills) ? entry.skills : []) {
    const skill = obj(raw);
    if (!skill) continue;
    const name = str(skill.name);
    const path = str(skill.path);
    if (!name || !path || skill.enabled === false) continue;
    const ui = obj(skill.interface);
    out.push({
      name,
      invocation: `$${name}`,
      description: str(ui?.shortDescription) ?? str(skill.description) ?? str(skill.shortDescription) ?? '',
      argumentHint: '',
      kind: 'skill',
      path,
    });
  }
  return out;
}

/** Public command metadata never exposes the skill's absolute on-disk path. */
export const codexCommands = (exe: string, cwd: string, spawn?: CodexSpawner): Promise<HarnessCommandDTO[]> =>
  withCodex(exe, async (rpc) => (await listSkills(rpc, cwd)).map(({ path: _, ...command }) => command), spawn);

/** The plan's usage window right now, or null if Codex doesn't report one. */
export const codexPlanUsage = (exe: string, spawn?: CodexSpawner) =>
  withCodex(exe, async (rpc) => planUsageFromCodex(obj(await rpc.request('account/rateLimits/read', null))), spawn);

const WINDOWS: Record<number, string> = { 300: 'five_hour', 10080: 'seven_day' };

/** Codex's rate-limit snapshot (or account/rateLimits/read reply) as the café's plan usage. */
export function planUsageFromCodex(reply: Obj | null): PlanUsageDTO | null {
  const byId = obj(reply?.rateLimitsByLimitId);
  const snap = obj(byId?.codex) ?? obj(reply?.rateLimits) ?? reply;
  if (!snap) return null;
  const windows = [obj(snap.primary), obj(snap.secondary)].filter((w): w is Obj => w !== null && num(w.usedPercent) !== null);
  if (windows.length === 0) return null;
  const w = windows.reduce((a, b) => (num(b.usedPercent)! > num(a.usedPercent)! ? b : a));
  const mins = num(w.windowDurationMins);
  const reached = snap.rateLimitReachedType != null || snap.spendControlReached === true;
  return {
    status: reached ? 'rejected' : 'allowed',
    window: mins !== null ? WINDOWS[mins] ?? null : null,
    utilization: Math.min(1, Math.max(0, num(w.usedPercent)! / 100)),
    resetsAt: epochToIso(num(w.resetsAt)),
  };
}

// ── One task ─────────────────────────────────────────────────────────────────

function isInside(root: string, path: string): boolean {
  const rel = relative(resolve(root), resolve(root, path));
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
const isSame = (a: string, b: string) => relative(resolve(a), resolve(b)) === '';

/** Resolve existing links, including parents of files that a patch will create. */
function physicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    // A dangling link is not a new file. Its destination cannot be verified.
    try {
      lstatSync(path);
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw statError;
      const parent = dirname(path);
      if (parent === path) throw err;
      return resolve(physicalPath(parent), basename(path));
    }
    throw err;
  }
}

function patchInsideProject(root: string, paths: string[]): boolean {
  if (!paths.length || !paths.every((p) => isInside(root, p))) return false;
  try {
    const physicalRoot = physicalPath(resolve(root));
    return paths.every((p) => isInside(physicalRoot, physicalPath(resolve(root, p))));
  } catch {
    return false; // Let the user decide when a path cannot be resolved.
  }
}

/**
 * Why the policy Codex says it applied is looser than the café's, or null if it
 * isn't. Checks the effective policy (after config.toml), not just what was sent.
 */
export function policyProblem(opened: Obj | null, workDir: string): string | null {
  if (opened?.approvalPolicy !== THREAD_POLICY.approvalPolicy) return `approval policy is ${JSON.stringify(opened?.approvalPolicy)}, not "untrusted"`;
  if (opened.approvalsReviewer !== THREAD_POLICY.approvalsReviewer) return `approvals go to ${JSON.stringify(opened.approvalsReviewer)} instead of you`;
  const sandbox = obj(opened.sandbox);
  if (sandbox?.type !== 'workspaceWrite') return `sandbox is ${JSON.stringify(sandbox?.type)}, not workspaceWrite`;
  if (sandbox.networkAccess !== false) return 'network access is on in the sandbox';
  if (!Array.isArray(sandbox.writableRoots)) return 'Codex didn’t report its writable folders';
  const outside = sandbox.writableRoots.find((r) => typeof r !== 'string' || !(isSame(workDir, r) || isInside(workDir, r)));
  if (outside !== undefined) return `a writable folder is outside the project (${String(outside)})`;
  const cwd = str(opened.cwd);
  if (!cwd || !isSame(workDir, cwd)) return `it would work in a different folder (${cwd ?? 'unknown'})`;
  return null;
}

function failureFor(info: unknown): FailureKind {
  if (info === 'usageLimitExceeded' || info === 'rateLimitExceeded') return 'usage_limit';
  if (info === 'unauthorized') return 'signed_out';
  return 'provider_error';
}

function toolFor(item: Obj): { tool: string; input: unknown } | null {
  switch (item.type) {
    case 'commandExecution':
      return { tool: 'shell', input: { command: str(item.command), cwd: str(item.cwd) } };
    case 'fileChange':
      return { tool: 'apply_patch', input: { files: changedPaths(item) } };
    case 'mcpToolCall':
      return { tool: `${str(item.server) ?? 'mcp'}.${str(item.tool) ?? 'tool'}`, input: item.arguments ?? null };
    case 'dynamicToolCall':
      return { tool: str(item.tool) ?? str(item.name) ?? 'tool', input: item.arguments ?? null };
    case 'webSearch':
      return { tool: 'web_search', input: { query: str(item.query) } };
    default:
      return null;
  }
}

function toolResult(item: Obj): { ok: boolean; output: string } {
  const status = str(item.status);
  switch (item.type) {
    case 'commandExecution': {
      const exit = num(item.exitCode);
      const out = str(item.aggregatedOutput) ?? '';
      return { ok: status === 'completed' && (exit === null || exit === 0), output: status === 'declined' ? 'Declined.' : out };
    }
    case 'fileChange': {
      const changes = Array.isArray(item.changes) ? item.changes.map(obj).filter((c): c is Obj => c !== null) : [];
      return { ok: status === 'completed', output: status === 'declined' ? 'Declined.' : changes.map((c) => str(c.diff) ?? str(c.path) ?? '').join('\n') };
    }
    case 'mcpToolCall': {
      const err = obj(item.error);
      const content = obj(item.result)?.content;
      const text = Array.isArray(content) ? content.map((c) => str(obj(c)?.text) ?? '').filter(Boolean).join('\n') : '';
      return { ok: status === 'completed' && !err, output: err ? str(err.message) ?? 'Failed.' : text };
    }
    case 'dynamicToolCall': {
      const content = Array.isArray(item.contentItems) ? item.contentItems : [];
      return { ok: item.success !== false && status === 'completed', output: content.map((c) => str(obj(c)?.text) ?? '').join('\n') };
    }
    default:
      return { ok: status !== 'failed' && status !== 'declined', output: '' };
  }
}

/** Each change's file, and where an update moves it (kind.move_path), if anywhere. */
function fileChanges(item: Obj | undefined): Array<{ path: string; moveTo: string | null }> {
  const changes = Array.isArray(item?.changes) ? item.changes.map(obj) : [];
  return changes.flatMap((c) => {
    const path = str(c?.path);
    return path ? [{ path, moveTo: str(obj(c?.kind)?.move_path) }] : [];
  });
}
/** Every path a patch writes: sources and move destinations. */
const touchedPaths = (item: Obj | undefined): string[] => fileChanges(item).flatMap((c) => (c.moveTo ? [c.path, c.moveTo] : [c.path]));
/** "a.ts", or "a.ts → b.ts" for a move. */
const changedPaths = (item: Obj | undefined): string[] => fileChanges(item).map((c) => (c.moveTo ? `${c.path} → ${c.moveTo}` : c.path));

function describePermissions(p: Obj | null): string {
  const parts: string[] = [];
  if (obj(p?.network)) parts.push('network access');
  const fs = obj(p?.fileSystem);
  if (fs) parts.push(`file access (${JSON.stringify(fs).slice(0, 200)})`);
  return parts.length ? `Wants ${parts.join(' and ')}` : 'Wants extra permissions';
}

export async function runCodexTask(ctx: CodexRunContext): Promise<RunOutcome> {
  const { task, agent, signal, emit } = ctx;
  const totals: RunTotals = { inputTokens: 0, outputTokens: 0, costUsd: null, steps: 0 };
  const done = (r: RunResult): RunOutcome => ({ ...r, totals });
  if (signal.aborted) return done({ status: 'cancelled' });

  // Ends pending approvals when the run is over, however it ends.
  const runAc = new AbortController();
  const onAbort = () => runAc.abort();
  signal.addEventListener('abort', onAbort, { once: true });

  let threadId: string | null = null;
  let turnId: string | null = null;
  let finished: Obj | null = null;
  let lastAgentText = '';
  let lastError: string | null = null;
  const items = new Map<string, Obj>();
  const open = new Set<string>(); // tool items started but not completed

  // A step is one agent message. Its model.end waits for the next message (or the
  // end of the turn) so token usage reported after the message lands in it.
  let step: { id: string; text: string } | null = null;
  let usageBase: { input: number; output: number } | null = null;
  const usage = { input: 0, output: 0 };
  const counted = { input: 0, output: 0 };
  const endStep = () => {
    if (!step) return;
    const input = usage.input - counted.input;
    const output = usage.output - counted.output;
    emit({ kind: 'model.end', step: totals.steps, text: step.text, inputTokens: input, outputTokens: output, costUsd: null });
    totals.inputTokens += input;
    totals.outputTokens += output;
    counted.input = usage.input;
    counted.output = usage.output;
    step = null;
  };
  const beginStep = (id: string) => {
    if (step?.id === id) return;
    endStep();
    totals.steps += 1;
    step = { id, text: '' };
    emit({ kind: 'model.start', step: totals.steps, maxOutputTokens: 0 });
  };

  let turnEnded!: () => void;
  const turnDone = new Promise<void>((r) => (turnEnded = r));
  const ours = (p: Obj | null) => {
    if (!p) return false;
    if (threadId && str(p.threadId) && p.threadId !== threadId) return false;
    if (turnId && str(p.turnId) && p.turnId !== turnId) return false;
    return true;
  };

  const onNotification = (method: string, params: unknown) => {
    const p = obj(params);
    if (!ours(p)) return;
    switch (method) {
      case 'item/started':
      case 'item/completed': {
        const item = obj(p!.item);
        const id = item && str(item.id);
        if (!item || !id) return;
        items.set(id, item);
        if (item.type === 'agentMessage') {
          beginStep(id);
          if (method === 'item/completed') {
            step!.text = str(item.text) ?? step!.text;
            if (step!.text) lastAgentText = step!.text;
          }
          return;
        }
        const t = toolFor(item);
        if (!t) return;
        if (method === 'item/started' && !open.has(id)) {
          open.add(id);
          emit({ kind: 'status', status: 'tool_wait' });
          emit({ kind: 'tool.start', step: totals.steps, callId: id, tool: t.tool, input: t.input });
        } else if (method === 'item/completed') {
          if (!open.has(id)) {
            emit({ kind: 'status', status: 'tool_wait' });
            emit({ kind: 'tool.start', step: totals.steps, callId: id, tool: t.tool, input: t.input });
          }
          open.delete(id);
          const r = toolResult(item);
          emit({ kind: 'tool.end', step: totals.steps, callId: id, tool: t.tool, ok: r.ok, output: r.output.slice(0, MAX_TOOL_OUTPUT_CHARS) });
          emit({ kind: 'status', status: 'running' });
        }
        return;
      }
      case 'item/agentMessage/delta': {
        const id = str(p!.itemId);
        const delta = str(p!.delta);
        if (!id || !delta) return;
        beginStep(id);
        step!.text += delta;
        emit({ kind: 'model.delta', step: totals.steps, text: delta });
        return;
      }
      case 'thread/tokenUsage/updated': {
        const tu = obj(p!.tokenUsage);
        const total = obj(tu?.total);
        const last = obj(tu?.last);
        const ti = num(total?.inputTokens);
        const to = num(total?.outputTokens);
        if (ti === null || to === null) return;
        // `total` covers the whole thread (earlier tasks too, on a follow-up): count from here.
        usageBase ??= { input: ti - (num(last?.inputTokens) ?? 0), output: to - (num(last?.outputTokens) ?? 0) };
        usage.input = Math.max(0, ti - usageBase.input);
        usage.output = Math.max(0, to - usageBase.output);
        return;
      }
      case 'account/rateLimits/updated': {
        const u = planUsageFromCodex(obj(p!.rateLimits));
        if (u) ctx.onUsage(u);
        return;
      }
      case 'error': {
        const msg = str(obj(p!.error)?.message);
        if (!msg) return;
        if (p!.willRetry === true) emit({ kind: 'log', level: 'warn', message: `Codex is retrying: ${msg}` });
        else lastError = msg;
        return;
      }
      case 'turn/completed': {
        const turn = obj(p!.turn);
        if (!turn || (turnId && str(turn.id) !== turnId)) return;
        finished = turn;
        turnEnded();
        return;
      }
    }
  };

  // Approvals go to the user one at a time (the task holds one pending approval).
  let queue: Promise<unknown> = Promise.resolve();
  const ask = (a: ApprovalAsk): Promise<'allow' | 'deny' | 'cancel'> => {
    const next = queue.then(async () => {
      if (runAc.signal.aborted) return 'cancel' as const;
      const d = await ctx.approve(a, runAc.signal);
      return runAc.signal.aborted ? ('cancel' as const) : d;
    });
    queue = next.catch(() => {});
    return next;
  };

  const onRequest = async (method: string, params: unknown): Promise<unknown> => {
    const p = obj(params);
    if (threadId && p && str(p.threadId) && p.threadId !== threadId) throw new RpcReplyError(-32602, 'Not this task’s thread.');
    switch (method) {
      case 'item/tool/call': {
        if (!ctx.collaboration) throw new RpcReplyError(-32601, 'Café collaboration tools are not enabled.');
        if (!threadId || p?.threadId !== threadId || !turnId || p.turnId !== turnId || runAc.signal.aborted) {
          throw new RpcReplyError(-32602, 'Not an active Café collaboration turn.');
        }
        try {
          const result = await ctx.collaboration.call(str(p.tool) ?? '', p.arguments);
          return { success: true, contentItems: [{ type: 'inputText', text: JSON.stringify(result) }] };
        } catch (err) {
          return { success: false, contentItems: [{ type: 'inputText', text: (err as Error).message }] };
        }
      }
      case 'item/commandExecution/requestApproval': {
        const command = str(p?.command);
        const d = await ask({
          tool: 'shell',
          summary: command ?? (p?.kind === 'writeStdin' ? 'Send input to a running command' : 'Run a command'),
          reason: str(p?.reason),
          ...(command && p?.kind !== 'writeStdin' ? { match: command } : {}),
        });
        return { decision: d === 'allow' ? 'accept' : d === 'deny' ? 'decline' : 'cancel' };
      }
      case 'item/fileChange/requestApproval': {
        const change = items.get(str(p?.itemId) ?? '');
        const paths = changedPaths(change);
        // Sources and move destinations both have to stay in the project.
        const touched = touchedPaths(change);
        const inProject = patchInsideProject(agent.workDir, touched) && !str(p?.grantRoot);
        if (agent.permission === 'acceptEdits' && inProject && !runAc.signal.aborted) {
          emit({ kind: 'log', level: 'info', message: `Auto-accepted edit (Auto-accept edits): ${paths.join(', ')}` });
          return { decision: 'accept' };
        }
        const d = await ask({ tool: 'apply_patch', summary: paths.join(', ') || 'Edit files', reason: str(p?.reason) });
        return { decision: d === 'allow' ? 'accept' : d === 'deny' ? 'decline' : 'cancel' };
      }
      case 'item/permissions/requestApproval': {
        const requested = obj(p?.permissions);
        const d = await ask({ tool: 'permissions', summary: describePermissions(requested), reason: str(p?.reason) });
        const granted: Obj = {};
        if (d === 'allow' && obj(requested?.network)) granted.network = requested!.network;
        if (d === 'allow' && obj(requested?.fileSystem)) granted.fileSystem = requested!.fileSystem;
        return { permissions: granted, scope: 'turn' };
      }
      case 'item/tool/requestUserInput': {
        const questions = Array.isArray(p?.questions) ? p.questions.map(obj).filter((q): q is Obj => q !== null) : [];
        emit({ kind: 'log', level: 'info', message: 'Codex asked a question; told it to make a sensible choice.' });
        return { answers: Object.fromEntries(questions.map((q) => [str(q.id) ?? '', { answers: [NO_QUESTIONS] }])) };
      }
      case 'mcpServer/elicitation/request':
        return { action: 'decline', content: null, _meta: null };
      default:
        throw new RpcReplyError(-32601, `Agents Café doesn't handle ${method}.`);
    }
  };

  let rpc: CodexRpc | null = null;
  try {
    rpc = await openCodex(ctx.executable, { onNotification, onRequest, onMalformed: () => {} }, ctx.spawn, !!ctx.collaboration);

    const account = obj(obj(await rpc.request('account/read', {}))?.account);
    if (!account) return done({ status: 'failed', failureKind: 'signed_out', error: 'Codex isn’t signed in. Connect ChatGPT in Settings.' });
    if (account.type !== 'chatgpt') {
      return done({ status: 'failed', failureKind: 'signed_out', error: 'Codex is signed in with an API key. Agents Café runs on your ChatGPT plan: connect ChatGPT in Settings.' });
    }
    if (task.model && task.model !== 'default') {
      const models = await listModels(rpc);
      if (models.length && !models.some((m) => m.value === task.model)) {
        return done({
          status: 'failed',
          failureKind: 'provider_error',
          error: `${task.model} isn’t available in Codex for this account. Pick one of: ${models.map((m) => m.label).join(', ')}.`,
        });
      }
    }
    if (process.platform === 'win32') {
      const status = str(obj(await rpc.request('windowsSandbox/readiness', null))?.status);
      if (status !== 'ready') {
        return done({
          status: 'failed',
          failureKind: 'provider_error',
          error: `Codex's Windows sandbox isn't set up (${status ?? 'unknown'}), and Agents Café won't run Codex without it. Open the Codex app and finish its sandbox setup, then retry.`,
        });
      }
    }
    if (signal.aborted) return done({ status: 'cancelled' });

    const commandMatch = task.prompt.trim().match(/^([/$])([^\s]+)(?:\s+([\s\S]*))?$/);
    let skills: CodexSkillCommand[] = [];
    if (commandMatch) {
      try {
        skills = await listSkills(rpc, agent.workDir);
      } catch (err) {
        if (commandMatch[2]?.toLowerCase() === 'skills') throw err;
      }
    }
    if (commandMatch?.[1] === '/' && commandMatch[2]?.toLowerCase() === 'skills') {
      return done({ status: 'completed', output: formatCommandCatalog('Codex', skills) });
    }
    const selectedSkill = commandMatch ? skills.find((skill) => skill.name.toLowerCase() === commandMatch[2]?.toLowerCase()) : undefined;
    const prompt = selectedSkill ? `${selectedSkill.invocation}${commandMatch?.[3] ? ` ${commandMatch[3]}` : ''}` : task.prompt;

    const params = {
      cwd: agent.workDir,
      ...THREAD_POLICY,
      config: SANDBOX_CONFIG,
      // Codex persists these in the thread; thread/resume restores them.
      ...(!ctx.resume && ctx.collaboration ? { dynamicTools: codexCollaborationTools } : {}),
      ...(agent.systemPrompt ? { developerInstructions: agent.systemPrompt } : {}),
      ...(task.model && task.model !== 'default' ? { model: task.model } : {}),
    };
    let opened: Obj | null;
    try {
      opened = obj(ctx.resume ? await rpc.request('thread/resume', { threadId: ctx.resume, ...params, excludeTurns: true }) : await rpc.request('thread/start', params));
    } catch (err) {
      if (ctx.resume && err instanceof CodexRpcError && err.kind === 'rpc') {
        return done({ status: 'failed', failureKind: 'provider_error', error: `Couldn't reopen this Codex conversation (${err.message}). Start a new thread instead.` });
      }
      throw err;
    }
    threadId = idOf(field(opened, 'thread', 'thread reply'), 'thread');
    // Cancelled while the thread was opening: never send the prompt.
    if (signal.aborted) return done({ status: 'cancelled' });
    // Never run under a looser policy than asked for.
    const problem = policyProblem(opened, agent.workDir);
    if (problem) {
      return done({
        status: 'failed',
        failureKind: 'provider_error',
        error: `Codex didn't apply Agents Café's approval and sandbox settings (${problem}), so the task didn't run. Check ~/.codex/config.toml.`,
      });
    }
    ctx.onSession?.(threadId);

    const started = obj(await rpc.request('turn/start', {
      threadId,
      input: [
        { type: 'text', text: prompt, text_elements: [] },
        ...(selectedSkill ? [{ type: 'skill', name: selectedSkill.name, path: selectedSkill.path }] : []),
      ],
    }));
    turnId = idOf(field(started, 'turn', 'turn reply'), 'turn');

    const aborted = new Promise<void>((r) => (signal.aborted ? r() : signal.addEventListener('abort', () => r(), { once: true })));
    const gone = rpc.exited;
    await Promise.race([turnDone, aborted, gone]);

    if (!finished && signal.aborted && rpc.isAlive) {
      // Ask Codex to stop, give it a moment to wind down, then the finally kills it.
      await rpc.request('turn/interrupt', { threadId, turnId }, 5000).catch(() => {});
      await Promise.race([turnDone, gone, new Promise((r) => setTimeout(r, ctx.interruptGraceMs ?? 5000).unref?.())]);
    }
    const turn = finished as Obj | null;
    for (const id of open) {
      emit({ kind: 'tool.end', step: totals.steps, callId: id, tool: toolFor(items.get(id) ?? {})?.tool ?? 'tool', ok: false, output: 'Stopped.' });
    }
    open.clear();
    endStep();

    if (signal.aborted) return done({ status: 'cancelled' });
    if (!turn) {
      const exit = await Promise.race([gone, Promise.resolve(null)]);
      return done({ status: 'failed', failureKind: 'provider_error', error: exit ? exitMessage(exit) : 'Codex stopped without finishing the turn.' });
    }
    const status = str(turn.status);
    if (status === 'completed') return done({ status: 'completed', output: lastAgentText });
    const err = obj(turn.error);
    if (status === 'interrupted') return done({ status: 'failed', failureKind: 'provider_error', error: str(err?.message) ?? lastError ?? 'Codex interrupted the turn.' });
    return done({
      status: 'failed',
      failureKind: failureFor(err?.codexErrorInfo),
      error: str(err?.message) ?? lastError ?? `Codex ended the turn (${status ?? 'unknown status'}).`,
    });
  } catch (err) {
    endStep();
    if (signal.aborted) return done({ status: 'cancelled' });
    if (err instanceof CodexRpcError && err.kind === 'unsupported') {
      return done({ status: 'failed', failureKind: 'provider_error', error: `This Codex doesn't support ${err.method}. Run \`codex update\` (Agents Café needs ${CODEX_MIN_VERSION}+).` });
    }
    return done({ status: 'failed', failureKind: 'provider_error', error: err instanceof Error ? err.message : String(err) });
  } finally {
    runAc.abort();
    signal.removeEventListener('abort', onAbort);
    await rpc?.close();
  }
}
