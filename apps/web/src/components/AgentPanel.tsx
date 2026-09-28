'use client';

import {
  HARNESS,
  isActive,
  isTerminal,
  type AgentDTO,
  type AgentPermission,
  type FailureKind,
  type HarnessModelDTO,
  type TaskDTO,
  type TaskEventDTO,
} from '@agent-cafe/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { api } from '@/lib/api';
import { duration, FLOOR_NAME, PROVIDER_NAME, STATUS_LABEL, STATUS_TONE, taskDuration, tokens, usd } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useCafe } from '@/store/cafe';
import { activeTaskFor, latestTaskFor, tasksFor } from '@/store/reduce';
import { Avatar } from './Avatar';
import { ACTIVITY_TONE, Label, StatusDot } from './Panel';

const FAILURE_COPY: Record<FailureKind, string> = {
  provider_error: 'The provider returned an error.',
  budget: 'Stopped at this order’s budget cap.',
  max_steps: 'Stopped after too many steps without a final answer.',
  refusal: 'The model declined this request.',
  usage_limit: 'Your plan’s usage limit was reached. It resets on its own.',
  signed_out: 'The harness isn’t signed in.',
};

// ── Agent selected ───────────────────────────────────────────────────────────

export function AgentDetail({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const state = useCafe();
  const now = useNow(500);
  const agent = state.agents[agentId];
  const active = activeTaskFor(state, agentId);
  const task: TaskDTO | undefined = (state.selectedTaskId && state.tasks[state.selectedTaskId]) || latestTaskFor(state, agentId);
  const history = tasksFor(state, agentId).slice(0, 8);

  // Pull the full event log once per task (the stream only carries what happens after connect).
  const loadHistory = state.loadHistory;
  const taskId = task?.id;
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    api
      .task(taskId)
      .then((r) => !cancelled && loadHistory(taskId, r.events))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [taskId, loadHistory]);

  if (!agent) return null;
  const activity = deriveActivity({
    activeTask: active,
    latestTask: latestTaskFor(state, agentId),
    lastEvent: active ? state.lastEvent[active.id] : undefined,
    lastActivityAt: active ? state.lastActivityAt[active.id] : undefined,
    now,
  });

  return (
    <div className="flex flex-col">
      <header className="flex items-start gap-3 border-b-2 border-slate-line p-4">
        <Avatar seed={agent.spriteSeed} providerId={agent.providerId} scale={3} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-3xl leading-none">{agent.name}</h2>
          <p className="mt-1 truncate text-xs text-chalk-dim">
            {PROVIDER_NAME[agent.providerId]} · {agent.model}
          </p>
          <p className="text-[11px] text-chalk-faint">{FLOOR_NAME[agent.providerId]}</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs" style={{ color: ACTIVITY_TONE[activity.kind] }}>
            <StatusDot color={ACTIVITY_TONE[activity.kind]} pulse={activity.kind === 'thinking'} />
            {activityLabel(activity)}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Back to the board"
          className="grid size-7 place-items-center border-2 border-walnut-dark font-display text-xl text-chalk-dim hover:text-chalk"
        >
          ×
        </button>
      </header>

      <AgentSetup agent={agent} />

      {task ? <TaskView task={task} now={now} /> : <p className="p-4 text-xs text-chalk-faint">No orders yet. Send one from the order pad.</p>}

      {history.length > 1 && (
        <section className="border-t-2 border-slate-line p-4">
          <Label className="mb-2">Earlier orders</Label>
          <ul className="flex flex-col gap-0.5">
            {history.map((t) => (
              <li key={t.id}>
                <button
                  onClick={() => state.selectAgent(agentId, t.id)}
                  aria-current={t.id === task?.id}
                  className={`flex w-full items-center gap-2 px-1.5 py-1 text-left text-[11px] ${t.id === task?.id ? 'bg-slate-2 text-chalk' : 'text-chalk-dim hover:bg-slate-2'}`}
                >
                  <StatusDot color={STATUS_TONE[t.status]} />
                  <span className="min-w-0 flex-1 truncate">{t.prompt}</span>
                  <span className="shrink-0 text-chalk-faint">{t.isMock ? usd(t.costUsd) : tokens(t.inputTokens + t.outputTokens)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TaskView({ task, now }: { task: TaskDTO; now: number }) {
  const events = useCafe((s) => s.events[task.id]);
  const streamText = useCafe((s) => s.streamText[task.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const select = useCafe((s) => s.selectAgent);
  const elapsed = taskDuration(task, now);
  const running = isActive(task.status);

  const act = async (fn: () => Promise<TaskDTO>) => {
    setBusy(true);
    setError(null);
    try {
      const t = await fn();
      if (t.id !== task.id) select(t.agentId, t.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-4 p-4" aria-label="Current order">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className="border-2 px-1.5 py-0.5 font-label text-[10px] uppercase"
          style={{ borderColor: STATUS_TONE[task.status], color: STATUS_TONE[task.status] }}
        >
          {STATUS_LABEL[task.status]}
        </span>
        {task.isMock && <span className="font-label text-[10px] uppercase text-brass">Demo</span>}
        <span className="ml-auto flex gap-2">
          {(task.status === 'queued' || running) && (
            <ActionButton disabled={busy} onClick={() => act(() => api.cancelTask(task.id))}>
              Cancel
            </ActionButton>
          )}
          {isTerminal(task.status) && (
            <ActionButton disabled={busy} onClick={() => act(() => api.retryTask(task.id))}>
              Retry
            </ActionButton>
          )}
        </span>
      </div>
      {error && <p role="alert" className="text-xs text-coral">{error}</p>}

      <dl className="grid grid-cols-4 gap-2 text-center">
        <Metric label="Time" value={elapsed === null ? '—' : duration(elapsed)} />
        <Metric label="Steps" value={String(task.steps)} />
        <Metric label="Tokens" value={`${tokens(task.inputTokens)}/${tokens(task.outputTokens)}`} title="Input / output tokens" />
        {task.isMock ? (
          <Metric label="Cost" value={usd(task.costUsd)} title={`Demo price; budget cap ${usd(task.maxCostUsd, 2)}`} />
        ) : (
          <Metric label="Billed" value="Plan" title="Runs on your subscription" />
        )}
      </dl>

      <div>
        <Label className="mb-1">Order</Label>
        <p className="whitespace-pre-wrap break-words text-xs text-chalk">{task.prompt}</p>
      </div>

      {(task.output || streamText || task.error) && (
        <div>
          <Label className="mb-1">{running ? 'Writing…' : task.status === 'completed' ? 'Output' : 'What happened'}</Label>
          {task.error && (
            <p className="mb-2 border-l-2 border-coral pl-2 text-xs text-coral">
              {task.failureKind ? `${FAILURE_COPY[task.failureKind]} ` : ''}
              {task.error}
            </p>
          )}
          {(task.output || (running && streamText)) && (
            <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words bg-slate-2 p-2.5 font-mono text-xs leading-relaxed text-chalk scroll-chalk">
              {task.output ?? streamText}
              {running && <span className="animate-pulse">▌</span>}
            </pre>
          )}
        </div>
      )}

      <Timeline task={task} events={events ?? []} />
    </section>
  );
}

function Timeline({ task, events }: { task: TaskDTO; events: TaskEventDTO[] }) {
  const start = Date.parse(task.startedAt ?? task.createdAt);
  const listRef = useRef<HTMLOListElement>(null);
  const rows = useMemo(() => events.map((e) => describe(e)).filter((r): r is Row => r !== null), [events]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);
  if (rows.length === 0) return null;
  return (
    <div>
      <Label className="mb-1">Timeline</Label>
      <ol ref={listRef} className="max-h-64 overflow-y-auto font-mono text-[11px] leading-relaxed scroll-chalk">
        {events.map((e) => {
          const r = describe(e);
          if (!r) return null;
          const t = (Date.parse(e.at) - start) / 1000;
          return (
            <li key={e.seq} className="grid grid-cols-[3.25rem_1fr] gap-2">
              <span className="text-right text-chalk-faint">{t >= 0 ? `+${t.toFixed(1)}s` : ''}</span>
              <span style={{ color: r.tone }} className="break-words">
                {r.text}
                {r.detail && <span className="block text-chalk-faint">{r.detail}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

interface Row {
  text: string;
  detail?: string;
  tone: string;
}

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n)}…` : s);

function describe(e: TaskEventDTO): Row | null {
  switch (e.kind) {
    case 'status':
      if (e.status === 'tool_wait' || e.status === 'running') return e.status === 'running' && e.seq <= 2 ? { text: 'Started', tone: 'var(--color-chalk-dim)' } : null;
      return {
        text: e.status === 'queued' ? 'Order taken' : STATUS_LABEL[e.status],
        ...(e.note ? { detail: short(e.note, 160) } : {}),
        tone: STATUS_TONE[e.status],
      };
    case 'model.start':
      return { text: `Step ${e.step} · thinking`, tone: 'var(--color-chalk-dim)' };
    case 'model.end':
      return {
        text: `Step ${e.step} · ${tokens(e.inputTokens)} in / ${tokens(e.outputTokens)} out${e.costUsd === null ? '' : ` · ${usd(e.costUsd)}`}`,
        ...(e.text ? { detail: short(e.text) } : {}),
        tone: 'var(--color-chalk)',
      };
    case 'tool.start':
      return { text: `→ ${e.tool}`, detail: short(JSON.stringify(e.input)), tone: 'var(--color-amber)' };
    case 'tool.end':
      return {
        text: e.ok ? `← ${e.tool}` : `✕ ${e.tool} failed`,
        detail: short(e.output),
        tone: e.ok ? 'var(--color-mint)' : 'var(--color-coral)',
      };
    case 'log':
      return {
        text: e.message,
        tone: e.level === 'error' ? 'var(--color-coral)' : e.level === 'warn' ? 'var(--color-amber)' : 'var(--color-chalk-dim)',
      };
    case 'approval.request':
      return { text: `? Asked to use ${e.approval.tool}`, detail: short(e.approval.summary, 160), tone: 'var(--color-amber)' };
    case 'approval.resolved':
      return { text: e.decision === 'allow' ? '✓ You allowed it' : '✕ You denied it', tone: e.decision === 'allow' ? 'var(--color-mint)' : 'var(--color-coral)' };
    case 'model.delta':
      return null;
  }
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="bg-slate-2 px-1 py-1.5" title={title}>
      <dd className="font-display text-xl leading-none text-chalk">{value}</dd>
      <dt className="mt-0.5 font-label text-[9px] uppercase text-chalk-faint">{label}</dt>
    </div>
  );
}

function ActionButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="border-2 border-walnut-dark bg-walnut px-2.5 py-0.5 font-label text-[10px] uppercase text-chalk hover:bg-walnut-light disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// ── Setup: model, working folder, permission ─────────────────────────────────

const PERMISSIONS: Array<{ value: AgentPermission; label: string; hint: string }> = [
  { value: 'ask', label: 'Ask first', hint: 'Asks before editing files or running commands.' },
  { value: 'acceptEdits', label: 'Auto-accept edits', hint: 'Edits files without asking; commands still ask.' },
];

function AgentSetup({ agent }: { agent: AgentDTO }) {
  const provider = useCafe((s) => s.providers[agent.providerId]);
  const [models, setModels] = useState<HarnessModelDTO[] | null>(null);
  const [folder, setFolder] = useState(agent.workDir ?? '');
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const ids = { model: useId(), folder: useId() };
  const harness = HARNESS[agent.providerId];
  const live = provider?.mode === 'live';
  const connection = provider?.connection.state;

  useEffect(() => setFolder(agent.workDir ?? ''), [agent.workDir]);
  useEffect(() => {
    let cancelled = false;
    api
      .models(agent.providerId)
      .then((r) => !cancelled && setModels(r.models))
      .catch(() => !cancelled && setModels([]));
    return () => {
      cancelled = true;
    };
  }, [agent.providerId, connection]);

  const save = (patch: Parameters<typeof api.updateAgent>[1], done = 'Saved.') => {
    setNote(null);
    api
      .updateAgent(agent.id, patch)
      .then(() => setNote({ ok: true, text: done }))
      .catch((e: Error) => setNote({ ok: false, text: e.message }));
  };

  const options = models ?? [];
  const known = options.some((m) => m.value === agent.model);

  return (
    <details open={live && !agent.workDir} className="border-b-2 border-slate-line">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-2.5 font-label text-[10px] text-chalk-dim hover:text-chalk">
        SETUP
        {live && !agent.workDir && <span className="text-coral">· PICK A FOLDER</span>}
        <span className="ml-auto normal-case text-chalk-faint">{live ? harness.name : 'Demo'}</span>
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 text-xs">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.model} className="font-label text-[10px] text-chalk-dim">MODEL</label>
          <select
            id={ids.model}
            value={agent.model}
            onChange={(e) => save({ model: e.target.value }, 'Model saved. Applies to new tasks.')}
            className="h-9 border-2 border-slate-line bg-night px-2 text-chalk"
          >
            {!known && <option value={agent.model}>{agent.model}</option>}
            {options.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
                {m.description && m.description !== m.label ? ` · ${m.description}` : ''}
              </option>
            ))}
          </select>
        </div>

        <form
          className="flex flex-col gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            save({ workDir: folder.trim() || null }, folder.trim() ? 'Folder saved.' : 'Folder cleared.');
          }}
        >
          <label htmlFor={ids.folder} className="font-label text-[10px] text-chalk-dim">WORKING FOLDER</label>
          <div className="flex gap-1.5">
            <input
              id={ids.folder}
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              placeholder="C:\Users\you\projects\my-app"
              spellCheck={false}
              className="h-9 min-w-0 flex-1 border-2 border-slate-line bg-night px-2 font-mono text-[12px] text-chalk placeholder:text-chalk-faint"
            />
            <button
              type="submit"
              disabled={(folder.trim() || null) === agent.workDir}
              className="h-9 border-2 border-walnut-dark bg-walnut px-2.5 font-label text-[10px] text-chalk hover:bg-walnut-light disabled:opacity-40"
            >
              SAVE
            </button>
          </div>
          <p className="text-[11px] text-chalk-faint">Where {agent.name} reads and edits files on live runs. Paste a full path.</p>
        </form>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 font-label text-[10px] text-chalk-dim">PERMISSION</legend>
          {PERMISSIONS.map((opt) => (
            <label key={opt.value} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name={`perm-${agent.id}`}
                checked={agent.permission === opt.value}
                onChange={() => save({ permission: opt.value })}
                className="mt-0.5 accent-[var(--color-brass)]"
              />
              <span>
                <span className="text-chalk">{opt.label}</span>
                <span className="block text-[11px] text-chalk-faint">{opt.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {note && (
          <p role={note.ok ? 'status' : 'alert'} className={`text-[11px] ${note.ok ? 'text-mint' : 'text-coral'}`}>
            {note.text}
          </p>
        )}
      </div>
    </details>
  );
}
