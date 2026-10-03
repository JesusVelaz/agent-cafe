'use client';

import { HARNESS, offeredModel, type AgentPermission, type ProviderId } from '@agent-cafe/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useModelOptions } from '@/lib/models';
import { useAgentView, useCafe } from '@/store/cafe';
import { ModelPicker, PermissionPicker, ProjectPicker, TargetPicker, type Target } from './pickers';
import { Chip, FolderIcon, PixelSend } from './ui';

/** How long a success notice ("Sent to Steve.") stays up. */
const NOTICE_MS = 4000;

/**
 * The message box, docked at the bottom of the side panel (and Focus mode's bar).
 *
 * On the board it addresses whoever is free on a floor, or a named agent; with an
 * agent open it follows the panel: inside a thread it replies there (same
 * conversation, same project); on their thread list or a new thread it starts a
 * fresh thread and opens it. Model and permission are chosen per message.
 */
export function Composer({ variant }: { variant: 'panel' | 'bar' }) {
  const agents = useCafe((s) => s.agents);
  const providers = useCafe((s) => s.providers);
  const projects = useCafe((s) => s.projects);
  const tasks = useCafe((s) => s.tasks);
  const selectedAgentId = useCafe((s) => s.selectedAgentId);
  const selectAgent = useCafe((s) => s.selectAgent);

  const [boardTarget, setBoardTarget] = useState<Target>({ kind: 'any', provider: 'anthropic' });
  // The café view's bar always addresses the board, not whoever was open in the panel.
  const selected = variant === 'panel' && selectedAgentId ? agents[selectedAgentId] : undefined;
  const target: Target = selected ? { kind: 'agent', agentId: selected.id } : boardTarget;
  const agent = target.kind === 'agent' ? agents[target.agentId] : undefined;
  const provider: ProviderId = agent?.providerId ?? (target.kind === 'any' ? target.provider : 'anthropic');

  // Choices for "anyone" (per floor), and per-message overrides for a named agent.
  const [anyModel, setAnyModel] = useState<Partial<Record<ProviderId, string>>>({});
  const [anyPermission, setAnyPermission] = useState<AgentPermission>('ask');
  const [anyProject, setAnyProject] = useState<string | null | undefined>(undefined);
  const [override, setOverride] = useState<{ model?: string; permission?: AgentPermission; projectId?: string | null }>({});
  useEffect(() => setOverride({}), [agent?.id]);
  const agentView = useAgentView();
  const openThread = selected && agentView?.kind === 'thread' ? agentView.thread : undefined;

  const modelOptions = useModelOptions(provider);
  const models = modelOptions.models;
  const floorDefault = models.find((m) => m.tag === 'Default')?.value ?? models[0]?.value ?? '';
  const preferredModel = agent ? (override.model ?? agent.model) : (anyModel[provider] ?? floorDefault);
  const model = offeredModel(models, preferredModel)?.value ?? floorDefault;
  const permission = agent ? (override.permission ?? agent.permission) : anyPermission;
  const firstProject = Object.values(projects).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null;
  // A reply stays in its thread's project; a new thread picks one.
  const rawProject = openThread
    ? openThread.projectId
    : agent
      ? override.projectId !== undefined ? override.projectId : agent.projectId
      : anyProject !== undefined ? anyProject : firstProject;
  const projectId = rawProject && projects[rawProject] ? rawProject : null;

  const mode = providers[provider]?.mode;
  const live = mode === 'live';
  // Continue from the newest message that has a harness session to resume (a failed
  // first try may have none), so the reply keeps the thread's context.
  const continueFrom = openThread
    ? [...openThread.taskIds].reverse().map((id) => tasks[id]).find((t) => t?.sessionId) ?? openThread.last
    : undefined;

  const [prompt, setPrompt] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  // "Sent to Steve." fades on its own; errors stay until the next edit or send.
  useEffect(() => {
    if (!notice?.ok) return;
    const t = setTimeout(() => setNotice((n) => (n === notice ? null : n)), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  const promptId = useId();
  const box = useRef<HTMLTextAreaElement>(null);

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [prompt]);

  const blocked = mode === 'off' ? 'That floor is switched off.' : modelOptions.loading ? 'Loading available models…' : !model ? modelOptions.error ?? 'Choose an available model first.' : live && !projectId ? 'Pick a project for live work.' : null;

  const send = async () => {
    const text = prompt.trim();
    if (!text || sending) return;
    if (blocked) return setNotice({ ok: false, text: blocked });
    setSending(true);
    setNotice(null);
    try {
      const task = await api.createTask({
        prompt: text,
        ...(target.kind === 'agent' ? { agentId: target.agentId } : { providerId: target.provider }),
        model,
        permission,
        projectId,
        ...(continueFrom ? { continueTaskId: continueFrom.id } : {}),
      });
      setPrompt('');
      if (!agent) setNotice({ ok: true, text: `Sent to ${agents[task.agentId]?.name ?? 'an agent'}.` });
      // A new thread opens, so you're reading what you just started.
      if (variant === 'panel' && !openThread) selectAgent(task.agentId, task.id);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const placeholder = agent
    ? openThread
      ? `Reply to ${agent.name}…`
      : `Start a new thread with ${agent.name}…`
    : `Ask anyone ${provider === 'anthropic' ? 'upstairs' : 'downstairs'} to…`;
  const floorNote = mode === 'live' ? `Live · ${HARNESS[provider].name}` : mode === 'off' ? 'Floor is off' : 'Demo · no real calls';

  const projectChip = openThread ? (
    <Chip label={`Project: ${projectId ? projects[projectId]?.name : 'none'} (a thread stays in its project)`} title="A thread stays in its project. Start a new thread to work elsewhere." disabled>
      <FolderIcon size={12} />
      <span className="truncate">{projectId ? projects[projectId]?.name : 'No project'}</span>
    </Chip>
  ) : (
    <ProjectPicker
      projectId={projectId}
      required={live}
      onPick={(id) => (agent ? setOverride((o) => ({ ...o, projectId: id })) : setAnyProject(id))}
    />
  );

  return (
    <form
      aria-label={agent ? `Message ${agent.name}` : 'New task'}
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
      className={variant === 'panel' ? 'flex flex-col gap-1 border-t border-slate-line px-3 pb-2.5 pt-3' : 'flex flex-col items-end gap-1.5'}
    >
      {/* The café view's bar is one compact box; its messages float just above it. */}
      {variant === 'bar' && notice && (
        <p role="status" className={`rounded-lg bg-night-2/95 px-2.5 py-1 text-[12px] shadow-lg ${notice.ok ? 'text-mint' : 'text-coral'}`}>
          {notice.text}
        </p>
      )}
      <div
        className={`w-full rounded-xl border border-slate-line bg-slate px-3 pb-1.5 pt-2.5 focus-within:border-[#434a58] ${
          variant === 'bar' ? 'shadow-[0_18px_44px_rgba(0,0,0,.5)]' : ''
        }`}
      >
        <label htmlFor={promptId} className="sr-only">{placeholder}</label>
        <textarea
          id={promptId}
          ref={box}
          rows={2}
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            if (notice) setNotice(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={placeholder}
          className="block w-full resize-none bg-transparent text-[14px] leading-snug text-chalk outline-none placeholder:text-chalk-faint"
        />
        {/* Chips wrap to a second line when they don't fit; send stays pinned bottom-right. */}
        <div className="mt-1 flex min-w-0 items-end gap-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            {!selected && <TargetPicker target={boardTarget} onPick={setBoardTarget} />}
            <ModelPicker
              provider={provider}
              model={model}
              {...(agent ? { lockedTo: agent.providerId } : {})}
              onPick={(p, m) => {
                if (agent) setOverride((o) => ({ ...o, model: m }));
                else {
                  setAnyModel((a) => ({ ...a, [p]: m }));
                  if (p !== provider) setBoardTarget({ kind: 'any', provider: p });
                }
              }}
            />
            {variant === 'bar' && projectChip}
            {live && (
              <PermissionPicker value={permission} onPick={(v) => (agent ? setOverride((o) => ({ ...o, permission: v })) : setAnyPermission(v))} />
            )}
          </div>
          <PixelSend disabled={!prompt.trim() || sending || mode === 'off'} busy={sending} />
        </div>
      </div>
      {variant === 'panel' && (
        <div className="flex min-w-0 items-center gap-0.5 px-0.5">
          {projectChip}
          <span role="status" className={`ml-auto truncate pl-2 text-[11px] ${notice ? (notice.ok ? 'text-mint' : 'text-coral') : 'text-chalk-faint'}`}>
            {notice?.text ?? floorNote}
          </span>
        </div>
      )}
    </form>
  );
}
