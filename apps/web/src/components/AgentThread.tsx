'use client';

import { HARNESS, exchangeMessage, isActive, isTerminal, type AgentDTO, type TaskDTO, type TaskEventDTO } from '@agent-cafe/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ago, duration, FLOOR_NAME, taskDuration } from '@/lib/format';
import { modelLabel, useModels } from '@/lib/models';
import { useNow } from '@/lib/useNow';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { useCafe } from '@/store/cafe';
import { activeTaskFor, latestTaskFor, type ThreadSummary } from '@/store/reduce';
import { Avatar } from './Avatar';
import { ACTIVITY_TONE } from './Panel';
import { ApprovalCard, FAILURE_SHORT } from './SidePanel';
import { FolderIcon } from './ui';

/** How many of a thread's most recent messages it shows. */
const SHOWN = 40;

export function AgentHeader({ agent }: { agent: AgentDTO }) {
  const state = useCafe();
  const now = useNow(1000);
  const active = activeTaskFor(state, agent.id);
  const activity = deriveActivity({
    activeTask: active,
    latestTask: latestTaskFor(state, agent.id),
    lastEvent: active ? state.lastEvent[active.id] : undefined,
    lastActivityAt: active ? state.lastActivityAt[active.id] : undefined,
    now,
  });
  const tone = ACTIVITY_TONE[activity.kind];
  return (
    <div className="flex items-center gap-3 px-4 pb-3">
      <Avatar seed={agent.spriteSeed} providerId={agent.providerId} scale={3} />
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[30px] font-normal leading-[.9]">{agent.name}</h2>
        <p className="flex items-center gap-1.5 truncate text-[12px]" style={{ color: tone }}>
          <span aria-hidden className={`size-2 shrink-0 ${activity.kind === 'thinking' ? 'animate-pulse' : ''}`} style={{ background: tone }} />
          {activityLabel(activity)}
        </p>
      </div>
      <p className="shrink-0 text-right text-[12px] leading-snug text-chalk-faint">
        {FLOOR_NAME[agent.providerId]}
        <span className="block">{HARNESS[agent.providerId].name}</span>
      </p>
    </div>
  );
}

/** One thread as a conversation: your messages, their steps and answers. */
export function AgentThread({ thread }: { thread: ThreadSummary }) {
  const tasks = useCafe((s) => s.tasks);
  const shown = useMemo(
    () => thread.taskIds.slice(-SHOWN).map((id) => tasks[id]).filter((t): t is TaskDTO => t !== undefined),
    [tasks, thread.taskIds],
  );
  const loadHistory = useCafe((s) => s.loadHistory);
  const endRef = useRef<HTMLDivElement>(null);
  const events = useCafe((s) => s.events);
  const stream = useCafe((s) => s.streamText);

  // Fetch each shown task's full log once (the live stream only has what happened since connect).
  const ids = shown.map((t) => t.id).join(',');
  useEffect(() => {
    let cancelled = false;
    for (const id of ids.split(',').filter(Boolean)) {
      if (loaded.has(id)) continue;
      loaded.add(id);
      api
        .task(id)
        .then((r) => !cancelled && loadHistory(id, r.events))
        .catch(() => loaded.delete(id));
    }
    return () => {
      cancelled = true;
    };
  }, [ids, loadHistory]);

  // Keep the newest message in view as it streams.
  const last = shown.at(-1);
  const tail = last ? `${last.id}:${events[last.id]?.length ?? 0}:${stream[last.id]?.length ?? 0}:${last.status}` : '';
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [tail, thread.id]);

  if (shown.length === 0) {
    return <p className="px-5 py-6 text-[13px] text-chalk-faint">No messages in this thread yet.</p>;
  }
  return (
    <div className="flex flex-col gap-4 px-4 py-4">
      {shown.map((t, i) => (
        <TaskTurn key={t.id} task={t} startsThread={i === 0} />
      ))}
      <div ref={endRef} />
    </div>
  );
}

const loaded = new Set<string>();

function TaskTurn({ task, startsThread }: { task: TaskDTO; startsThread: boolean }) {
  const events = useCafe((s) => s.events[task.id]);
  const streamText = useCafe((s) => s.streamText[task.id]);
  const project = useCafe((s) => (task.projectId ? s.projects[task.projectId] : undefined));
  const source = useCafe((s) => task.sourceTaskId ? s.tasks[task.sourceTaskId] : undefined);
  const sender = useCafe((s) => source ? s.agents[source.agentId] : undefined);
  const senderName = task.exchange?.senderName ?? sender?.name;
  const senderProvider = task.exchange?.senderProviderId ?? sender?.providerId;
  const resultStatus = task.exchangeKind === 'result' ? task.exchange?.status ?? source?.status : undefined;
  const models = useModels(task.providerId);
  const now = useNow(1000);
  const blocks = useMemo(() => toBlocks(events ?? []), [events]);
  const running = isActive(task.status);
  const saidSomething = blocks.some((b) => b.kind === 'text');
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2.5">
      {startsThread && (
        <div className="flex items-center gap-2 text-[11px] text-chalk-faint" role="separator">
          <span className="h-px flex-1 bg-slate-line" />
          <span className="flex items-center gap-1">{project ? <><FolderIcon size={12} /> {project.name}</> : 'Demo'}</span>
          <span className="h-px flex-1 bg-slate-line" />
        </div>
      )}

      <div className="flex flex-col items-end gap-0.5">
        {task.exchangeKind && (
          <span className="text-[11px] text-mint">
            {task.exchangeKind === 'result' ? 'Result' : task.exchangeKind === 'delegation' ? 'Delegated task' : 'Message'}
            {senderName ? ` from ${senderName}${senderProvider ? ` · ${HARNESS[senderProvider].name}` : ''}` : ' from a teammate'}
            {resultStatus && resultStatus !== 'completed' ? ` · ${resultStatus}` : ''}
          </span>
        )}
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-mine px-3 py-2 text-[13px] leading-relaxed">{exchangeMessage(task)}</div>
        <span className="text-[11px] text-chalk-faint">
          {modelLabel(models, task.model)}
          {task.isMock ? ' · demo' : ''} · {ago(task.createdAt, now)}
        </span>
      </div>

      {blocks.map((b, i) =>
        b.kind === 'text' || b.kind === 'exchange' ? (
          <p key={i} className={`whitespace-pre-wrap break-words text-[13px] leading-relaxed ${b.kind === 'exchange' ? 'text-mint' : 'text-chalk'}`}>{b.text}</p>
        ) : b.kind === 'tools' ? (
          <div key={i} className="flex flex-col gap-0.5 border-l-2 border-slate-line py-1 pl-2.5 font-mono text-[12px]">
            {b.rows.map((r) => (
              <div key={r.id} className="flex min-w-0 gap-2.5">
                <span className={`min-w-12 shrink-0 ${r.ok === false ? 'text-coral' : r.ok ? 'text-chalk-faint' : 'text-mint'}`}>{r.tool}</span>
                <span className="truncate text-chalk-dim" title={r.summary}>{r.summary}</span>
              </div>
            ))}
          </div>
        ) : task.pendingApproval?.id === b.id ? (
          <ApprovalCard key={i} task={task} compact />
        ) : (
          <p key={i} className="text-[12px] text-chalk-faint">
            {b.decision === 'deny' ? '✕ You denied' : b.decision === 'allow' ? '✓ You allowed' : '? Asked to use'} {b.tool}
            <code className="ml-1.5 font-mono text-chalk-dim">{short(b.summary, 60)}</code>
          </p>
        ),
      )}

      {running && streamText?.trim() && !blocks.some((b) => b.kind === 'text' && b.text === streamText.trim()) && (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-chalk">
          {streamText}
          <span className="animate-pulse">▌</span>
        </p>
      )}

      {task.status === 'completed' && task.output && !saidSomething && (
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-chalk">{task.output}</p>
      )}

      <TurnFooter task={task} now={now} onError={setError} />
      {error && <p role="alert" className="text-[12px] text-coral">{error}</p>}
    </div>
  );
}

function TurnFooter({ task, now, onError }: { task: TaskDTO; now: number; onError: (e: string | null) => void }) {
  const retried = useCafe((s) => Object.values(s.tasks).some((t) => t.retryOf === task.id));
  const act = (fn: () => Promise<unknown>) => {
    onError(null);
    fn().catch((e: Error) => onError(e.message));
  };
  if (task.status === 'queued') {
    return (
      <p className="flex items-center gap-2 text-[12px] text-chalk-faint">
        Queued
        <button type="button" onClick={() => act(() => api.cancelTask(task.id))} className="rounded px-1.5 text-chalk-dim underline decoration-dotted hover:text-chalk">Cancel</button>
      </p>
    );
  }
  if (isActive(task.status)) {
    return (
      <p className="flex items-center gap-2 text-[12px] text-chalk-faint">
        <span aria-hidden className="size-1.5 animate-pulse bg-mint" />
        Working · {duration(taskDuration(task, now) ?? 0)}
        <button type="button" onClick={() => act(() => api.cancelTask(task.id))} className="rounded px-1.5 text-chalk-dim underline decoration-dotted hover:text-chalk">Stop</button>
      </p>
    );
  }
  if (task.status === 'failed' || task.status === 'interrupted') {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-[#5a3128] bg-[#231817] px-3 py-2 text-[12px]">
        <p className="min-w-0 flex-1 text-coral">
          {task.status === 'interrupted' ? 'Interrupted by a restart' : task.failureKind ? FAILURE_SHORT[task.failureKind] : 'Failed'}
          {task.error ? <span className="block break-words text-chalk-dim">{task.error}</span> : null}
        </p>
        {retried ? (
          <span className="shrink-0 py-1 text-chalk-faint">Retried below</span>
        ) : (
          <button type="button" onClick={() => act(() => api.retryTask(task.id))} className="shrink-0 rounded-md border border-slate-line px-2.5 py-1 text-chalk hover:bg-slate-2">Retry</button>
        )}
      </div>
    );
  }
  if (isTerminal(task.status)) {
    return (
      <p className="text-[11px] text-chalk-faint">
        {task.status === 'cancelled' ? 'Stopped' : 'Done'} · {duration(taskDuration(task, now) ?? 0)}
        {task.steps > 0 ? ` · ${task.steps} step${task.steps === 1 ? '' : 's'}` : ''}
      </p>
    );
  }
  return null;
}

type Block =
  | { kind: 'text'; text: string }
  | { kind: 'exchange'; text: string }
  | { kind: 'tools'; rows: Array<{ id: string; tool: string; summary: string; ok: boolean | null }> }
  | { kind: 'ask'; id: string; tool: string; summary: string; decision: 'allow' | 'deny' | null };

/** Steps' text, runs of tool calls (grouped), and approvals, in order. */
function toBlocks(events: TaskEventDTO[]): Block[] {
  const out: Block[] = [];
  const toolRow = new Map<string, { ok: boolean | null }>();
  const asks = new Map<string, { decision: 'allow' | 'deny' | null }>();
  for (const e of events) {
    if (e.kind === 'model.end' && e.text.trim()) out.push({ kind: 'text', text: e.text.trim() });
    else if (e.kind === 'log' && e.message.startsWith('Café:')) out.push({ kind: 'exchange', text: e.message });
    else if (e.kind === 'tool.start') {
      const row = { id: e.callId, tool: e.tool, summary: summarize(e.input), ok: null as boolean | null };
      toolRow.set(e.callId, row);
      const prev = out.at(-1);
      if (prev?.kind === 'tools') prev.rows.push(row);
      else out.push({ kind: 'tools', rows: [row] });
    } else if (e.kind === 'tool.end') {
      const row = toolRow.get(e.callId);
      if (row) row.ok = e.ok;
    } else if (e.kind === 'approval.request') {
      const b: Extract<Block, { kind: 'ask' }> = { kind: 'ask', id: e.approval.id, tool: e.approval.tool, summary: e.approval.summary, decision: null };
      asks.set(e.approval.id, b);
      out.push(b);
    } else if (e.kind === 'approval.resolved') {
      const b = asks.get(e.approvalId);
      if (b) b.decision = e.decision;
    }
  }
  return out;
}

function summarize(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);
  return s('command') ?? s('file_path') ?? s('pattern') ?? s('url') ?? s('path') ?? s('query') ?? s('expression') ?? s('key') ?? JSON.stringify(input);
}

const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
