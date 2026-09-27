'use client';

import { isActive, isTerminal, type FailureKind, type TaskDTO, type TaskEventDTO } from '@agent-cafe/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { api } from '@/lib/api';
import { ago, duration, FLOOR_NAME, PROVIDER_NAME, STATUS_LABEL, STATUS_TONE, taskDuration, tokens, usd } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useCafe } from '@/store/cafe';
import { activeTaskFor, latestTaskFor, recentFinished, tasksFor } from '@/store/reduce';
import { Avatar } from './Avatar';
import { ACTIVITY_TONE } from './CrewRoster';
import { Label, StatusDot } from './Panel';

const FAILURE_COPY: Record<FailureKind, string> = {
  provider_error: 'The provider returned an error.',
  budget: 'Stopped at this order’s budget cap.',
  daily_cap: 'This floor reached its daily spending cap.',
  max_steps: 'Stopped after too many steps without a final answer.',
  refusal: 'The model declined this request.',
};

/** Right rail: the chalkboard. Agent details when one is selected, recent orders otherwise. */
export function Inspector() {
  const selectedAgentId = useCafe((s) => s.selectedAgentId);
  return (
    <aside
      aria-label="Inspector"
      className="chalkboard scroll-chalk flex min-h-0 flex-col overflow-y-auto lg:w-[380px] lg:border-l-[3px] lg:border-walnut-dark"
    >
      {selectedAgentId ? <AgentDetail agentId={selectedAgentId} /> : <RecentBoard />}
    </aside>
  );
}

// ── Nothing selected: what finished recently ─────────────────────────────────

function RecentBoard() {
  const state = useCafe();
  const now = useNow(5000);
  const recent = recentFinished(state, 12);
  return (
    <div className="flex flex-col gap-3 p-4">
      <div>
        <h2 className="font-display text-3xl leading-none">Order board</h2>
        <p className="mt-1 text-xs text-chalk-dim">Click an agent or a cup on the counter to see its work.</p>
      </div>
      <Label>Recently finished</Label>
      {recent.length === 0 ? (
        <p className="text-xs text-chalk-faint">No finished orders yet. Send one from the order pad below.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-line">
          {recent.map((t) => (
            <li key={t.id}>
              <button
                onClick={() => state.selectAgent(t.agentId, t.id)}
                className="flex w-full items-start gap-2 py-2 text-left hover:bg-slate-2"
              >
                <StatusDot color={STATUS_TONE[t.status]} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-chalk">{t.prompt}</span>
                  <span className="text-[11px] text-chalk-faint">
                    {state.agents[t.agentId]?.name ?? '—'} · {duration(taskDuration(t, now) ?? 0)} · {usd(t.costUsd)}
                    {t.isMock && ' demo'} · {ago(t.finishedAt!, now)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Agent selected ───────────────────────────────────────────────────────────

function AgentDetail({ agentId }: { agentId: string }) {
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
        <Avatar seed={agent.spriteSeed} demo={(task ?? active)?.isMock ?? state.providers[agent.providerId]?.mode === 'mock'} scale={3} />
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
          onClick={() => state.selectAgent(null)}
          aria-label="Close inspector"
          className="grid size-7 place-items-center border-2 border-walnut-dark font-display text-xl text-chalk-dim hover:text-chalk"
        >
          ×
        </button>
      </header>

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
                  <span className="shrink-0 text-chalk-faint">{usd(t.costUsd)}</span>
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
        <Metric label="Cost" value={usd(task.costUsd)} title={`Budget cap ${usd(task.maxCostUsd, 2)}`} />
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
        text: `Step ${e.step} · ${tokens(e.inputTokens)} in / ${tokens(e.outputTokens)} out · ${usd(e.costUsd)}`,
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
