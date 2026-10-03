'use client';

import { DEFAULTS, isTerminal, type FailureKind, type TaskDTO } from '@agent-cafe/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ago, duration, taskDuration } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { useAgentView, useCafe } from '@/store/cafe';
import { agentThreads, latestTaskFor, needsAttention, projectGroups, type Attention, type ProjectGroup, type ThreadSummary } from '@/store/reduce';
import { AgentHeader, AgentThread } from './AgentThread';
import { Avatar } from './Avatar';
import { Composer } from './Composer';
import { ACTIVITY_TONE } from './Panel';
import { FolderIcon, SectionHeading } from './ui';

export const FAILURE_SHORT: Record<FailureKind, string> = {
  provider_error: 'Something went wrong',
  budget: 'Hit its budget cap',
  max_steps: 'Ran out of steps',
  refusal: 'Model declined',
  usage_limit: 'Plan usage limit reached',
  signed_out: 'Not signed in',
};

/**
 * The right-hand panel: the board, or an agent (their thread list, one thread, or a
 * new thread); the composer is always at the bottom and follows what's open.
 */
export function SidePanel() {
  const agent = useCafe((s) => (s.selectedAgentId ? s.agents[s.selectedAgentId] : undefined));
  const selectAgent = useCafe((s) => s.selectAgent);
  const setPanelCollapsed = useCafe((s) => s.setPanelCollapsed);
  const view = useAgentView();
  const inside = agent && view && view.kind !== 'list';
  return (
    <aside aria-label={agent ? agent.name : 'Work board'} className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-night-2">
      <div className="border-b border-slate-line">
        <div className="flex h-12 items-center justify-between pl-3 pr-1.5">
          {agent ? (
            <button
              type="button"
              onClick={() => (inside ? selectAgent(agent.id) : selectAgent(null))}
              className="flex h-9 items-center gap-1.5 rounded-lg px-2 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M9 2.5L4.5 7 9 11.5" /></svg>
              {inside ? 'Threads' : 'Board'}
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
      {/* Keyed by view, so each one opens at its own top rather than where the last was scrolled. */}
      <div key={!agent || !view ? 'board' : view.kind === 'thread' ? view.thread.id : `${agent.id}:${view.kind}`} className="scroll-chalk min-h-0 overflow-y-auto">
        {!agent || !view ? (
          <Board />
        ) : view.kind === 'thread' ? (
          <AgentThread thread={view.thread} />
        ) : view.kind === 'new' ? (
          <p className="px-5 py-6 text-[13px] text-chalk-faint">New thread with {agent.name}. Your first message below starts it, with a fresh context.</p>
        ) : (
          <ThreadList agentId={agent.id} />
        )}
      </div>
      <Composer variant="panel" />
    </aside>
  );
}

/** One agent's threads, newest first, and a way to start another. */
function ThreadList({ agentId }: { agentId: string }) {
  const tasks = useCafe((s) => s.tasks);
  const projects = useCafe((s) => s.projects);
  const selectAgent = useCafe((s) => s.selectAgent);
  const startThread = useCafe((s) => s.startThread);
  const now = useNow(1000);
  const threads = agentThreads({ tasks }, agentId);
  return (
    <section aria-labelledby="t-list" className="flex flex-col gap-2 px-4 py-4">
      <SectionHeading
        id="t-list"
        tone="var(--color-chalk-dim)"
        action={
          <button
            type="button"
            onClick={startThread}
            className="flex h-7 items-center gap-1 rounded-full border border-slate-line px-2.5 text-[12px] text-chalk-dim hover:bg-slate hover:text-chalk"
          >
            <span aria-hidden>＋</span> New thread
          </button>
        }
      >
        THREADS
      </SectionHeading>
      {threads.length === 0 && <p className="px-2 py-1 text-[13px] text-chalk-faint">No threads yet. Send a message below to start one.</p>}
      <div className="flex flex-col gap-0.5">
        {threads.map((th) => {
          const project = th.projectId ? projects[th.projectId]?.name : null;
          return (
            <button
              key={th.id}
              type="button"
              onClick={() => selectAgent(agentId, th.last.id)}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate"
            >
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-chalk" title={th.title}>{th.title}</span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-chalk-faint">
                  <span className="truncate">
                    {[th.from && `from ${th.from}`, project, `${th.messages} ${th.messages === 1 ? 'message' : 'messages'}`].filter(Boolean).join(' · ')}
                  </span>
                  <span aria-hidden>·</span>
                  <ThreadStatus task={th.last} now={now} />
                </span>
              </span>
              <span className="pt-px text-[12px] text-chalk-faint">{ago(th.at, now)}</span>
            </button>
          );
        })}
      </div>
    </section>
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

/** What needs you, then every thread: those at work first (with what they're doing), then the rest. */
function Board() {
  const state = useCafe();
  const now = useNow(1000);
  const attention = needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec);
  const groups = projectGroups(state);
  const working = groups.reduce((n, g) => n + g.working, 0);
  const [folded, setFolded] = useFolded();

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

      <section aria-labelledby="b-threads">
        <SectionHeading
          id="b-threads"
          tone="var(--color-mint)"
          action={<span className="text-[12px] text-chalk-faint">{working > 0 ? `${working} working` : 'All quiet'}</span>}
        >
          THREADS
        </SectionHeading>
        {groups.length === 0 && <p className="px-2 py-1 text-[13px] text-chalk-faint">No threads yet. Send a task below to start one.</p>}
        <div className="flex flex-col gap-2">
          {groups.map((g) => {
            const key = g.projectId ?? DEMO_GROUP;
            return (
              <ProjectThreads
                key={key}
                group={g}
                now={now}
                folded={folded.has(key)}
                onToggle={() => setFolded(key, !folded.has(key))}
              />
            );
          })}
        </div>
      </section>
    </div>
  );
}

const DEMO_GROUP = 'demo';
const FOLDED_KEY = 'cafe.foldedProjects';
/** How many threads a project shows before "Show N more". */
const PER_PROJECT = 5;

/** Which project groups are folded, remembered in this browser. */
function useFolded(): [ReadonlySet<string>, (key: string, fold: boolean) => void] {
  const [folded, setFoldedState] = useState<ReadonlySet<string>>(() => new Set());
  // Read after mount, so the server render matches the first client render.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
      if (Array.isArray(saved)) setFoldedState(new Set(saved.filter((k): k is string => typeof k === 'string')));
    } catch {
      /* nothing saved, or storage is unavailable */
    }
  }, []);
  const set = (key: string, fold: boolean) =>
    setFoldedState((prev) => {
      const next = new Set(prev);
      if (fold) next.add(key);
      else next.delete(key);
      try {
        localStorage.setItem(FOLDED_KEY, JSON.stringify([...next]));
      } catch {
        /* private mode: just not remembered */
      }
      return next;
    });
  return [folded, set];
}

/** A project's heading (fold it to hide its threads) and its newest threads. */
function ProjectThreads({ group, now, folded, onToggle }: { group: ProjectGroup; now: number; folded: boolean; onToggle: () => void }) {
  const project = useCafe((s) => (group.projectId ? s.projects[group.projectId] : undefined));
  const [all, setAll] = useState(false);
  const name = group.projectId ? project?.name ?? 'Removed project' : 'Demo';
  const shown = all ? group.threads : group.threads.slice(0, PER_PROJECT);
  const hidden = group.threads.length - shown.length;
  const bodyId = `threads-${group.projectId ?? DEMO_GROUP}`;
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!folded}
        aria-controls={bodyId}
        title={project?.path}
        className="flex h-8 items-center gap-2 rounded-lg px-2 text-left text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className={`shrink-0 transition-transform ${folded ? '-rotate-90' : ''}`}>
          <path d="M2.5 4l2.5 2.5L7.5 4" />
        </svg>
        <FolderIcon size={14} />
        <span className="min-w-0 flex-1 truncate font-semibold text-chalk">{name}</span>
        <span className="shrink-0 text-[12px] text-chalk-faint">
          {group.working > 0 && <span className="text-mint">{group.working} working · </span>}
          {group.threads.length}
        </span>
      </button>
      {!folded && (
        <div id={bodyId} className="flex flex-col gap-0.5 pl-3">
          {shown.map((th) => (
            <ThreadRow key={th.id} thread={th} now={now} />
          ))}
          {(hidden > 0 || all) && group.threads.length > PER_PROJECT && (
            <button type="button" onClick={() => setAll((a) => !a)} className="self-start rounded-md px-2 py-1 text-[12px] text-chalk-faint hover:bg-slate hover:text-chalk">
              {all ? 'Show fewer' : `Show ${hidden} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const OUTCOME: Partial<Record<TaskDTO['status'], { label: string; tone: string; mark: 'done' | 'failed' | 'stopped' }>> = {
  completed: { label: 'Done', tone: 'text-mint', mark: 'done' },
  failed: { label: 'Failed', tone: 'text-coral', mark: 'failed' },
  interrupted: { label: 'Interrupted', tone: 'text-coral', mark: 'failed' },
  cancelled: { label: 'Stopped', tone: 'text-chalk-faint', mark: 'stopped' },
};

function OutcomeMark({ status }: { status: TaskDTO['status'] }) {
  const o = OUTCOME[status];
  if (!o) return <span aria-label="Working" className="size-2 shrink-0 bg-mint" />;
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-label={o.label} className={`shrink-0 ${o.tone}`}>
      <path d={o.mark === 'done' ? 'M2.5 7.5l3 3 6-7' : o.mark === 'failed' ? 'M3.5 3.5l7 7M10.5 3.5l-7 7' : 'M3.5 7h7'} />
    </svg>
  );
}

/** How a thread ended, or, while it works, what it's doing and for how long. */
function ThreadStatus({ task, now }: { task: TaskDTO; now: number }) {
  const state = useCafe();
  const o = OUTCOME[task.status];
  if (o) {
    return (
      <span className={`flex shrink-0 items-center gap-1 ${o.tone}`}>
        <OutcomeMark status={task.status} /> {o.label}
      </span>
    );
  }
  if (task.status === 'queued') return <span className="shrink-0 text-chalk-faint">Queued</span>;
  const activity = deriveActivity({
    activeTask: task,
    latestTask: latestTaskFor(state, task.agentId),
    lastEvent: state.lastEvent[task.id],
    lastActivityAt: state.lastActivityAt[task.id],
    now,
  });
  const tone = ACTIVITY_TONE[activity.kind];
  return (
    <span className="flex min-w-0 items-center gap-1.5" style={{ color: tone }}>
      <span aria-hidden className={`size-2 shrink-0 ${activity.kind === 'thinking' ? 'animate-pulse' : ''}`} style={{ background: tone }} />
      <span className="truncate">{activityLabel(activity)}</span>
      <span className="shrink-0 text-chalk-faint">· {duration(taskDuration(task, now) ?? 0)}</span>
    </span>
  );
}

/**
 * One conversation, under its project's heading: what it's about, who has it, what
 * it's doing or how it ended; work it delegated tucked under it.
 */
function ThreadRow({ thread, now }: { thread: ThreadSummary; now: number }) {
  const agents = useCafe((s) => s.agents);
  const selectAgent = useCafe((s) => s.selectAgent);
  const agent = agents[thread.agentId];
  const working = !isTerminal(thread.last.status);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => selectAgent(thread.agentId, thread.last.id)}
        className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-x-2.5 rounded-lg px-2 py-2 text-left hover:bg-slate"
      >
        {agent ? <Avatar seed={agent.spriteSeed} providerId={agent.providerId} scale={2} /> : <span />}
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-chalk" title={thread.title}>{thread.title}</span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] text-chalk-faint">
            <span className={working ? 'shrink-0' : 'truncate'}>
              <b className="font-semibold text-chalk-dim">{agent?.name ?? 'Someone'}</b>
              {!working && (
                <>
                  {thread.from && <> · from {thread.from}</>} · {thread.messages} {thread.messages === 1 ? 'message' : 'messages'}
                </>
              )}
            </span>
            <span aria-hidden>·</span>
            <ThreadStatus task={thread.last} now={now} />
          </span>
        </span>
        <span className="pt-px text-[12px] text-chalk-faint">{working ? 'now' : ago(thread.at, now)}</span>
      </button>
      {thread.children.map((c) => {
        const who = agents[c.agentId];
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => selectAgent(c.agentId, c.last.id)}
            className="ml-9 grid grid-cols-[12px_21px_minmax(0,1fr)_auto_auto] items-center gap-x-2 rounded-lg px-2 py-1 text-left text-[12px] hover:bg-slate"
          >
            <span aria-hidden className="text-chalk-faint">↳</span>
            {who ? <Avatar seed={who.spriteSeed} providerId={who.providerId} scale={1.5} /> : <span />}
            <span className="min-w-0 truncate text-chalk-dim" title={c.title}>
              <b className="font-semibold">{who?.name ?? 'Someone'}</b> <span className="text-chalk-faint">{c.title}</span>
            </span>
            <OutcomeMark status={c.last.status} />
            <span className="text-chalk-faint">{ago(c.at, now)}</span>
          </button>
        );
      })}
    </div>
  );
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

