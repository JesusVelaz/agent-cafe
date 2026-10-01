'use client';

import { DEFAULTS, type FailureKind, type TaskDTO } from '@agent-cafe/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ago, duration, taskDuration, usd } from '@/lib/format';
import { modelLabel, useModels } from '@/lib/models';
import { useNow } from '@/lib/useNow';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { useCafe } from '@/store/cafe';
import { latestTaskFor, needsAttention, queuedFor, recentFinished, type Attention } from '@/store/reduce';
import { AgentHeader, AgentThread } from './AgentThread';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { ACTIVITY_TONE } from './Panel';
import { SectionHeading } from './ui';

export const FAILURE_SHORT: Record<FailureKind, string> = {
  provider_error: 'Something went wrong',
  budget: 'Hit its budget cap',
  max_steps: 'Ran out of steps',
  refusal: 'Model declined',
  usage_limit: 'Plan usage limit reached',
  signed_out: 'Not signed in',
};

/** The right-hand panel: the board, or the selected agent's thread; the composer is always at the bottom. */
export function SidePanel() {
  const selectedAgentId = useCafe((s) => s.selectedAgentId);
  const agent = useCafe((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : undefined));
  const selectAgent = useCafe((s) => s.selectAgent);
  const setPanelCollapsed = useCafe((s) => s.setPanelCollapsed);
  return (
    <aside aria-label={agent ? agent.name : 'Work board'} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-night-2">
      <div className="border-b border-slate-line">
        <div className="flex h-12 items-center justify-between pl-3 pr-1.5">
          {agent ? (
            <button type="button" onClick={() => selectAgent(null)} className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M9 2.5L4.5 7 9 11.5" /></svg>
              Board
            </button>
          ) : (
            <h2 className="px-2 font-label text-[11px] font-normal tracking-wide text-chalk-dim">WORK BOARD</h2>
          )}
          <button
            type="button"
            aria-label="Collapse the panel"
            title="Collapse the panel"
            onClick={() => setPanelCollapsed(true)}
            className="grid size-9 place-items-center rounded-lg text-chalk-dim hover:bg-slate hover:text-chalk"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M4 3l5 5-5 5M9 3l5 5-5 5" /></svg>
          </button>
        </div>
        {agent && <AgentHeader agent={agent} />}
      </div>
      <div className="scroll-chalk min-h-0 overflow-y-auto">{selectedAgentId && agent ? <AgentThread agentId={selectedAgentId} /> : <Board />}</div>
      <Composer variant="panel" />
    </aside>
  );
}

/** The folded panel: expand, what needs you, and everyone's status at a glance. */
export function PanelRail() {
  const state = useCafe();
  const now = useNow(1000);
  const attention = needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec);
  const crew = Object.values(state.agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const open = (agentId?: string) => {
    state.setPanelCollapsed(false);
    if (agentId) state.selectAgent(agentId);
  };
  return (
    <nav aria-label="Agents" className="scroll-chalk flex h-full w-full flex-col items-center gap-1.5 overflow-y-auto overflow-x-hidden bg-night-2 py-2 [scrollbar-width:none]">
      <button type="button" aria-label="Expand the panel" title="Expand the panel" onClick={() => open()} className="grid size-10 place-items-center rounded-lg text-chalk-dim hover:bg-slate hover:text-chalk">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M12 3L7 8l5 5M7 3L2 8l5 5" /></svg>
      </button>
      {attention.length > 0 && (
        <button
          type="button"
          aria-label={`${attention.length} need you`}
          title={`${attention.length} need you`}
          onClick={() => open(attention[0]!.agentId)}
          className="grid size-10 place-items-center rounded-lg border border-coral font-label text-[12px] text-coral hover:bg-slate"
        >
          {attention.length}
        </button>
      )}
      <span aria-hidden className="my-1 h-px w-7 bg-slate-line" />
      {crew.map((a) => {
        const active = Object.values(state.tasks).find((t) => t.agentId === a.id && (t.status === 'running' || t.status === 'tool_wait'));
        const activity = deriveActivity({
          activeTask: active,
          latestTask: latestTaskFor(state, a.id),
          lastEvent: active ? state.lastEvent[active.id] : undefined,
          lastActivityAt: active ? state.lastActivityAt[active.id] : undefined,
          now,
        });
        return (
          <button
            key={a.id}
            type="button"
            aria-label={`${a.name}: ${activityLabel(activity)}`}
            title={`${a.name}: ${activityLabel(activity)}`}
            onClick={() => open(a.id)}
            className="relative grid size-10 place-items-center rounded-lg hover:bg-slate"
          >
            <Avatar seed={a.spriteSeed} providerId={a.providerId} scale={2} />
            <span aria-hidden className="absolute bottom-1 right-1 size-2.5 shadow-[0_0_0_2px_var(--color-night-2)]" style={{ background: ACTIVITY_TONE[activity.kind] }} />
          </button>
        );
      })}
    </nav>
  );
}

function Board() {
  const state = useCafe();
  const now = useNow(1000);
  const attention = needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec);
  const working = Object.values(state.tasks)
    .filter((t) => t.status === 'running' || t.status === 'tool_wait')
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
  const finished = recentFinished(state, 12).filter((t) => t.status === 'completed').slice(0, 6);
  const queued = queuedFor(state);
  const busy = new Set([...working.map((t) => t.agentId), ...queued.map((t) => t.agentId)]);
  const idle = Object.values(state.agents).filter((a) => !busy.has(a.id));

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      {attention.length > 0 && (
        <section aria-labelledby="b-need">
          <SectionHeading id="b-need" tone="var(--color-coral)" count={attention.length}>NEEDS YOU</SectionHeading>
          <div className="flex flex-col gap-2">
            {attention.map((a) => (a.kind === 'approval' ? <ApprovalCard key={a.task.id} task={a.task} /> : <AttentionCard key={a.task.id} item={a} now={now} />))}
          </div>
        </section>
      )}

      <section aria-labelledby="b-now">
        <SectionHeading id="b-now" tone="var(--color-mint)" count={working.length}>WORKING NOW</SectionHeading>
        {working.length === 0 && <p className="px-2 py-1 text-[13px] text-chalk-faint">Nobody is working right now. Send a task below.</p>}
        <div className="flex flex-col">
          {working.map((t) => (
            <WorkingRow key={t.id} task={t} now={now} />
          ))}
        </div>
        {(queued.length > 0 || idle.length > 0) && (
          <p className="px-2 pt-2 text-[12px] leading-relaxed text-chalk-faint">
            {queued.length > 0 && <>Queued: {summarize(queued.map((t) => state.agents[t.agentId]?.name ?? '?'))}. </>}
            {idle.length > 0 && <>Free: {idle.map((a) => a.name).join(', ')}.</>}
          </p>
        )}
      </section>

      <section aria-labelledby="b-done">
        <SectionHeading id="b-done" tone="var(--color-chalk-dim)">FINISHED</SectionHeading>
        {finished.length === 0 && <p className="px-2 py-1 text-[13px] text-chalk-faint">Nothing finished yet.</p>}
        <div className="flex flex-col">
          {finished.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => state.selectAgent(t.agentId, t.id)}
              className="grid grid-cols-[14px_72px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-slate"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Done" className="text-mint"><path d="M2.5 7.5l3 3 6-7" /></svg>
              <span className="truncate">{state.agents[t.agentId]?.name ?? '—'}</span>
              <span className="truncate text-chalk-dim">{t.prompt}</span>
              <span className="text-[12px] text-chalk-faint">{ago(t.finishedAt!, now)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function summarize(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, c]) => (c > 1 ? `${c} for ${n}` : n)).join(', ');
}

/** A harness asking before it acts: the command or file, and Deny / Allow. */
export function ApprovalCard({ task, compact }: { task: TaskDTO; compact?: boolean }) {
  const agent = useCafe((s) => s.agents[task.agentId]);
  const project = useCafe((s) => (task.projectId ? s.projects[task.projectId] : undefined));
  const selectAgent = useCafe((s) => s.selectAgent);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = task.pendingApproval!;
  const answer = (decision: 'allow' | 'deny') => {
    setBusy(true);
    setError(null);
    api
      .answerApproval(task.id, ask.id, decision)
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <article aria-label={`${agent?.name ?? 'Agent'} wants to use ${ask.tool}`} className="flex flex-col gap-2 rounded-xl border border-[#6b5a2a] bg-slate p-3">
      {compact ? (
        <p className="text-[12px] text-amber">Wants to use {ask.tool}</p>
      ) : (
        <div className="flex items-center gap-2.5">
          {agent && <Avatar seed={agent.spriteSeed} providerId={agent.providerId} scale={2} />}
          <div className="min-w-0 flex-1">
            <button type="button" onClick={() => selectAgent(task.agentId, task.id)} className="font-display text-[22px] leading-none hover:text-accent">
              {agent?.name ?? 'Unknown'}
            </button>
            <p className="text-[12px] text-amber">Wants to use {ask.tool}</p>
          </div>
        </div>
      )}
      <code className="scroll-chalk block max-h-28 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-code px-2.5 py-2 font-mono text-[12px] text-chalk">{ask.summary}</code>
      {ask.reason && <p className="text-[12px] text-chalk-dim">{ask.reason}</p>}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] text-chalk-faint">{project ? `in ${project.name}` : ''}</span>
        <button type="button" disabled={busy} onClick={() => answer('deny')} className="h-9 rounded-lg border border-slate-line px-3.5 text-[13px] text-chalk hover:bg-slate-2 disabled:opacity-50">
          Deny
        </button>
        <button type="button" disabled={busy} onClick={() => answer('allow')} className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white hover:bg-[#7f9bff] disabled:opacity-50">
          Allow
        </button>
      </div>
      {error && <p role="alert" className="text-[12px] text-coral">{error}</p>}
    </article>
  );
}

function AttentionCard({ item, now }: { item: Exclude<Attention, { kind: 'approval' }>; now: number }) {
  const agent = useCafe((s) => s.agents[item.agentId]);
  const selectAgent = useCafe((s) => s.selectAgent);
  const dismiss = useCafe((s) => s.dismiss);
  const [error, setError] = useState<string | null>(null);
  const t = item.task;
  const run = (fn: () => Promise<unknown>) => fn().catch((e: Error) => setError(e.message));
  const message =
    item.kind === 'stuck'
      ? `No activity for ${duration(item.quietSec * 1000)}`
      : `${t.status === 'interrupted' ? 'Interrupted by a restart' : t.failureKind ? FAILURE_SHORT[t.failureKind] : 'Failed'}${t.error ? `: ${t.error}` : ''}`;
  return (
    <article className="flex items-center gap-2.5 rounded-xl border border-slate-line bg-slate p-3">
      {agent && <Avatar seed={agent.spriteSeed} providerId={agent.providerId} scale={2} />}
      <button type="button" onClick={() => selectAgent(t.agentId, t.id)} className="min-w-0 flex-1 text-left">
        <span className="block font-display text-[22px] leading-none">{agent?.name ?? 'Unknown'}</span>
        <span className="block truncate text-[12px] text-coral" title={message}>{message}</span>
        <span className="block truncate text-[12px] text-chalk-faint">{t.prompt}{item.kind === 'failed' && t.finishedAt ? ` · ${ago(t.finishedAt, now)}` : ''}</span>
        {error && <span role="alert" className="block text-[12px] text-coral">{error}</span>}
      </button>
      {item.kind === 'stuck' ? (
        <button type="button" onClick={() => run(() => api.cancelTask(t.id))} className="h-9 rounded-lg border border-slate-line px-3 text-[13px] hover:bg-slate-2">Stop</button>
      ) : (
        <div className="flex gap-1">
          <button type="button" onClick={() => run(() => api.retryTask(t.id))} className="h-9 rounded-lg border border-slate-line px-3 text-[13px] hover:bg-slate-2">Retry</button>
          <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => dismiss(t.id)} className="grid size-9 place-items-center rounded-lg text-chalk-faint hover:bg-slate-2 hover:text-chalk">×</button>
        </div>
      )}
    </article>
  );
}

function WorkingRow({ task, now }: { task: TaskDTO; now: number }) {
  const state = useCafe();
  const agent = state.agents[task.agentId];
  const models = useModels(task.providerId);
  const activity = deriveActivity({
    activeTask: task,
    latestTask: latestTaskFor(state, task.agentId),
    lastEvent: state.lastEvent[task.id],
    lastActivityAt: state.lastActivityAt[task.id],
    now,
  });
  const tone = ACTIVITY_TONE[activity.kind];
  return (
    <button
      type="button"
      onClick={() => state.selectAgent(task.agentId, task.id)}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate"
    >
      {agent ? <Avatar seed={agent.spriteSeed} providerId={agent.providerId} scale={2} /> : <span />}
      <span className="min-w-0">
        <span className="block truncate text-[13px]">
          <b className="font-semibold">{agent?.name ?? '—'}</b> <span className="text-chalk-dim">· {task.prompt}</span>
        </span>
        <span className="block truncate text-[12px]" style={{ color: tone }}>{activityLabel(activity)}</span>
      </span>
      <span className="text-right text-[12px] text-chalk-dim">
        {duration(taskDuration(task, now) ?? 0)}
        <span className="block text-chalk-faint">{task.isMock ? `${usd(task.costUsd)} demo` : modelLabel(models, task.model)}</span>
      </span>
    </button>
  );
}

