'use client';

import { DEFAULTS, type FailureKind, type TaskDTO } from '@agent-cafe/shared';
import { useState } from 'react';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { api } from '@/lib/api';
import { ago, duration, FLOOR_NAME, taskDuration, usd } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useCafe } from '@/store/cafe';
import { latestTaskFor, needsAttention, queuedFor, recentFinished, type Attention } from '@/store/reduce';
import { AgentDetail } from './AgentPanel';
import { Composer } from './Composer';
import { ACTIVITY_TONE } from './Panel';

const FAILURE_SHORT: Record<FailureKind, string> = {
  provider_error: 'Provider error',
  budget: 'Hit its budget cap',
  daily_cap: 'Floor hit its daily cap',
  max_steps: 'Ran out of steps',
  refusal: 'Model declined',
};

/** The right-hand board: what needs you, who is working, what finished. Agent detail replaces it on select. */
export function WorkBoard() {
  const selectedAgentId = useCafe((s) => s.selectedAgentId);
  const selectAgent = useCafe((s) => s.selectAgent);
  return (
    <aside aria-label="Work board" className="scroll-chalk flex h-full min-h-0 flex-col overflow-y-auto bg-night">
      {selectedAgentId ? <AgentDetail agentId={selectedAgentId} onClose={() => selectAgent(null)} /> : <Board />}
    </aside>
  );
}

function Board() {
  const state = useCafe();
  const now = useNow(1000);
  const attention = needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec);
  const working = Object.values(state.tasks)
    .filter((t) => t.status === 'running' || t.status === 'tool_wait')
    .sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''));
  const finished = recentFinished(state, 12).filter((t) => t.status === 'completed').slice(0, 5);
  const queued = queuedFor(state);
  const busy = new Set([...working.map((t) => t.agentId), ...queued.map((t) => t.agentId)]);
  const idle = Object.values(state.agents).filter((a) => !busy.has(a.id));

  return (
    <div className="flex flex-col gap-5 px-5 py-4">
      <Composer variant="card" />

      {attention.length > 0 && (
        <section aria-labelledby="need-h" className="flex flex-col gap-2">
          <h2 id="need-h" className="font-label text-[11px] font-normal text-coral">NEEDS YOU · {attention.length}</h2>
          {attention.map((a) => (
            <AttentionCard key={a.task.id} item={a} now={now} />
          ))}
        </section>
      )}

      <section aria-labelledby="now-h" className="flex flex-col">
        <h2 id="now-h" className="mb-1.5 font-label text-[11px] font-normal text-mint">WORKING NOW · {working.length}</h2>
        {working.length === 0 && <p className="py-2 text-xs text-chalk-faint">Nobody is working right now. Send a task above.</p>}
        {working.map((t) => (
          <WorkingRow key={t.id} task={t} now={now} />
        ))}
        {(queued.length > 0 || idle.length > 0) && (
          <p className="pt-2 text-[12px] text-chalk-faint">
            {queued.length > 0 && <>Queued next: {summarize(queued.map((t) => state.agents[t.agentId]?.name ?? '?'))}. </>}
            {idle.length > 0 && <>Idle: {idle.map((a) => a.name).join(', ')}.</>}
          </p>
        )}
      </section>

      <section aria-labelledby="done-h" className="flex flex-col">
        <h2 id="done-h" className="mb-1.5 font-label text-[11px] font-normal text-chalk-dim">FINISHED RECENTLY</h2>
        {finished.length === 0 && <p className="py-1 text-xs text-chalk-faint">Nothing finished yet.</p>}
        {finished.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => state.selectAgent(t.agentId, t.id)}
            className="grid grid-cols-[14px_84px_minmax(0,1fr)_auto] items-center gap-2.5 px-1 py-1.5 text-left text-[13px] hover:bg-slate"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="var(--color-mint)" strokeWidth="2" aria-label="Done"><path d="M2.5 7.5l3 3 6-7" /></svg>
            <span className="truncate">{state.agents[t.agentId]?.name ?? '—'}</span>
            <span className="truncate text-chalk-dim">{t.prompt}</span>
            <span className="text-[12px] text-chalk-faint">
              {duration(taskDuration(t, now) ?? 0)} · {usd(t.costUsd)}{t.isMock ? ' demo' : ''} · {ago(t.finishedAt!, now)}
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}

function summarize(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
  return [...counts].map(([n, c]) => `${c} for ${n}`).join(', ');
}

function AttentionCard({ item, now }: { item: Attention; now: number }) {
  const agent = useCafe((s) => s.agents[item.agentId]);
  const selectAgent = useCafe((s) => s.selectAgent);
  const dismiss = useCafe((s) => s.dismiss);
  const [error, setError] = useState<string | null>(null);
  const t = item.task;
  const run = (fn: () => Promise<unknown>) => fn().catch((e: Error) => setError(e.message));
  const message =
    item.kind === 'stuck'
      ? `No activity for ${duration(item.quietSec * 1000)}. Probably stuck.`
      : `${t.status === 'interrupted' ? 'Interrupted by a restart' : t.failureKind ? FAILURE_SHORT[t.failureKind] : 'Failed'}${t.error ? `: ${t.error}` : ''}`;
  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-2 border-coral bg-slate-2 px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline gap-2.5">
          <span className="font-display text-2xl leading-none">{agent?.name ?? 'Unknown'}</span>
          <span className="truncate text-[11px] text-chalk-faint">
            {t.model} · {agent ? FLOOR_NAME[agent.providerId] : ''}
          </span>
        </div>
        <div className="line-clamp-2 text-[13px] text-coral">{message}</div>
        <div className="truncate text-[12px] text-chalk-dim">
          {t.prompt} · {item.kind === 'failed' && t.finishedAt ? ago(t.finishedAt, now) : `step ${t.steps}`}
        </div>
        {error && <div role="alert" className="text-[12px] text-coral">{error}</div>}
      </div>
      <div className="flex gap-1.5">
        <SmallButton onClick={() => selectAgent(t.agentId, t.id)}>OPEN</SmallButton>
        {item.kind === 'stuck' ? (
          <SmallButton onClick={() => run(() => api.cancelTask(t.id))}>CANCEL</SmallButton>
        ) : (
          <>
            <SmallButton primary onClick={() => run(() => api.retryTask(t.id))}>RETRY</SmallButton>
            <SmallButton label="Dismiss" onClick={() => dismiss(t.id)}>×</SmallButton>
          </>
        )}
      </div>
    </article>
  );
}

function WorkingRow({ task, now }: { task: TaskDTO; now: number }) {
  const state = useCafe();
  const agent = state.agents[task.agentId];
  const activity = deriveActivity({
    activeTask: task,
    latestTask: latestTaskFor(state, task.agentId),
    lastEvent: state.lastEvent[task.id],
    lastActivityAt: state.lastActivityAt[task.id],
    now,
  });
  const step = Math.max(task.steps, activity.kind === 'thinking' ? activity.step : task.steps);
  const tone = ACTIVITY_TONE[activity.kind];
  return (
    <button
      type="button"
      onClick={() => state.selectAgent(task.agentId, task.id)}
      className="grid grid-cols-[92px_minmax(0,1fr)_84px_64px] items-center gap-3 border-b border-slate-line px-1 py-2 text-left hover:bg-slate"
    >
      <span>
        <span className="block font-display text-[22px] leading-none">{agent?.name ?? '—'}</span>
        <span className="block truncate text-[11px] text-chalk-faint">{task.model}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px]">{task.prompt}</span>
        <span className="block truncate text-[12px]" style={{ color: tone }}>
          {activityLabel(activity)}
          {activity.kind === 'thinking' ? '' : ` · step ${step}`}
        </span>
      </span>
      <span className="flex gap-0.5" aria-label={`Step ${step} of ${DEFAULTS.maxSteps}`}>
        {Array.from({ length: DEFAULTS.maxSteps }, (_, i) => (
          <span key={i} className="h-2 flex-1" style={{ background: i < step ? tone : 'var(--color-slate-2)' }} />
        ))}
      </span>
      <span className="text-right text-[13px]">
        <span className="block">{duration(taskDuration(task, now) ?? 0)}</span>
        <span className="block text-[12px] text-chalk-faint">{usd(task.costUsd)}</span>
      </span>
    </button>
  );
}

function SmallButton({ children, onClick, primary, label }: { children: React.ReactNode; onClick: () => void; primary?: boolean; label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`h-11 min-w-11 border-2 px-2.5 font-label text-[10px] ${primary ? 'border-brass bg-brass text-night' : 'border-slate-line bg-slate text-chalk hover:bg-slate-2'}`}
    >
      {children}
    </button>
  );
}
