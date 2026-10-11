'use client';

import { HARNESS, offeredModel, type AgentPermission, type HarnessCommandDTO, type ProviderId } from '@agent-cafe/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { filterHarnessCommands, slashCommandQuery } from '@/lib/commands';
import { useModelOptions } from '@/lib/models';
import { useAgentView, useCafe } from '@/store/cafe';
import { Avatar } from './Avatar';
import { CommandMenu } from './CommandMenu';
import { ModelPicker, PermissionPicker, ProjectPicker, TargetPicker, type Target } from './pickers';
import { Chip, FolderIcon, PixelSend } from './ui';

/** How long a success notice ("Sent to Steve.") stays up. */
const NOTICE_MS = 4000;

/**
 * The message box. There's one: docked over the side panel's footer, or, with the
 * panel folded away (café view), floating bottom-right by the rail. It moves between
 * the two (same width, so only its place changes), and a draft and its choices come along.
 *
 * On the board it addresses whoever is free on a floor, or a named agent; with an
 * agent open it follows the panel: inside a thread it replies there (same
 * conversation, same project); on their thread list or a new thread it starts a
 * fresh thread and opens it. Model and permission are chosen per message.
 */
export function Composer({ onDockedHeight }: { onDockedHeight?: (px: number) => void }) {
  const agents = useCafe((s) => s.agents);
  const providers = useCafe((s) => s.providers);
  const projects = useCafe((s) => s.projects);
  const tasks = useCafe((s) => s.tasks);
  const selectedAgentId = useCafe((s) => s.selectedAgentId);
  const selectAgent = useCafe((s) => s.selectAgent);
  const floating = useCafe((s) => s.panelCollapsed);

  const [boardTarget, setBoardTarget] = useState<Target>({ kind: 'any', provider: 'anthropic' });
  const selected = selectedAgentId ? agents[selectedAgentId] : undefined;
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
  const [commands, setCommands] = useState<HarnessCommandDTO[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [commandsError, setCommandsError] = useState<string | null>(null);
  const [commandMenuDismissed, setCommandMenuDismissed] = useState(false);
  const [activeCommand, setActiveCommand] = useState(0);
  // "Sent to Steve." fades on its own; errors stay until the next edit or send.
  useEffect(() => {
    if (!notice?.ok) return;
    const t = setTimeout(() => setNotice((n) => (n === notice ? null : n)), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);
  const promptId = useId();
  const commandListId = useId();
  const box = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const commandQuery = slashCommandQuery(prompt);
  const commandMenuOpen = commandQuery !== null && !commandMenuDismissed;
  const shownCommands = commandQuery === null ? [] : filterHarnessCommands(commands, commandQuery);
  const commandProblem = !live
    ? 'Slash commands are available in Live mode.'
    : !projectId
      ? 'Pick a project to load its slash commands.'
      : commandsError;
  const menuCommands = commandProblem ? [] : shownCommands;

  useEffect(() => {
    if (!commandMenuOpen || !live || !projectId) return;
    let current = true;
    setCommands([]);
    setCommandsError(null);
    setCommandsLoading(true);
    void api.commands(provider, projectId).then(
      (result) => {
        if (!current) return;
        setCommands(result.commands);
        setCommandsError(result.source === 'unavailable' ? result.message ?? 'No slash commands are available.' : null);
      },
      (error: Error) => {
        if (!current) return;
        setCommands([]);
        setCommandsError(error.message);
      },
    ).finally(() => {
      if (current) setCommandsLoading(false);
    });
    return () => { current = false; };
  }, [commandMenuOpen, live, projectId, provider]);

  useEffect(() => setActiveCommand(0), [commandQuery, commands]);

  // Docked, the panel keeps a footer slot as tall as the composer.
  useEffect(() => {
    const el = form.current;
    if (!el || floating || !onDockedHeight) return;
    const ro = new ResizeObserver(() => onDockedHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [floating, onDockedHeight]);

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
      // Floating, there's no thread on screen to show it went, so say so.
      if (!agent || floating) setNotice({ ok: true, text: `Sent to ${agents[task.agentId]?.name ?? 'an agent'}.` });
      // In the panel a new thread opens, so you're reading what you just started;
      // in café view you watch them get up and start instead.
      if (!openThread && !floating) selectAgent(task.agentId, task.id);
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setSending(false);
    }
  };

  const pickCommand = (command: HarnessCommandDTO) => {
    setPrompt(`${command.invocation} `);
    setCommandMenuDismissed(true);
    setActiveCommand(0);
    requestAnimationFrame(() => box.current?.focus());
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

  // Floating with an agent open (the panel was folded on them), name who it goes to,
  // with a way back to addressing anyone.
  const agentChip = floating && selected && (
    <Chip label={`To ${selected.name}. Send to anyone instead`} title="Send to anyone instead" onClick={() => selectAgent(null)}>
      <Avatar seed={selected.spriteSeed} providerId={selected.providerId} scale={1} />
      <span className="truncate">{selected.name}</span>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2 2l6 6M8 2L2 8" /></svg>
    </Chip>
  );

  return (
    <div
      className={`absolute z-30 transition-[right,bottom,width] duration-300 ease-[cubic-bezier(.2,.8,.2,1)] ${
        floating ? 'bottom-4 right-4 w-[calc(100%-2rem)] lg:bottom-5 lg:right-[76px] lg:w-[519px]' : 'bottom-0 right-0 w-full lg:w-[519px]'
      }`}
    >
      {/* Floating, the result shows just above the box; docked, it's in the footer line. */}
      {floating && notice && !commandMenuOpen && (
        <p role="status" className={`absolute bottom-full right-0 mb-1.5 max-w-full truncate rounded-lg bg-night-2/95 px-2.5 py-1 text-[12px] shadow-lg ${notice.ok ? 'text-mint' : 'text-coral'}`}>
          {notice.text}
        </p>
      )}
      {commandMenuOpen && (
        <CommandMenu
          id={commandListId}
          provider={provider}
          commands={menuCommands}
          active={Math.min(activeCommand, Math.max(0, menuCommands.length - 1))}
          loading={commandsLoading && !commandProblem}
          error={commandProblem}
          onActive={setActiveCommand}
          onPick={pickCommand}
        />
      )}
      <form
        ref={form}
        aria-label={agent ? `Message ${agent.name}` : 'New task'}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className={`flex flex-col gap-1 border-slate-line bg-night-2 px-3 pb-2.5 pt-3 ${
          floating ? 'rounded-2xl border shadow-[0_18px_44px_rgba(0,0,0,.45)]' : 'border-t'
        }`}
      >
        <div className="w-full rounded-xl border border-slate-line bg-slate px-3 pb-1.5 pt-2.5 focus-within:border-[#434a58]">
          <label htmlFor={promptId} className="sr-only">{placeholder}</label>
          <textarea
            id={promptId}
            ref={box}
            rows={2}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              setCommandMenuDismissed(false);
              if (notice) setNotice(null);
            }}
            onKeyDown={(e) => {
              if (commandMenuOpen) {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setCommandMenuDismissed(true);
                  return;
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  if (menuCommands.length) {
                    const delta = e.key === 'ArrowDown' ? 1 : -1;
                    setActiveCommand((index) => (index + delta + menuCommands.length) % menuCommands.length);
                  }
                  return;
                }
                if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') {
                  const command = menuCommands[Math.min(activeCommand, menuCommands.length - 1)];
                  if (command) {
                    e.preventDefault();
                    pickCommand(command);
                    return;
                  }
                  if (e.key === 'Tab') return;
                  if (commandsLoading || commandProblem) {
                    e.preventDefault();
                    return;
                  }
                }
              }
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={placeholder}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={commandMenuOpen}
            aria-controls={commandMenuOpen ? commandListId : undefined}
            aria-activedescendant={commandMenuOpen && menuCommands.length ? `${commandListId}-${Math.min(activeCommand, menuCommands.length - 1)}` : undefined}
            className="block w-full resize-none bg-transparent text-[14px] leading-snug text-chalk outline-none placeholder:text-chalk-faint"
          />
          {/* The choices stay on one line (labels truncate if they run out of room); send stays right. */}
          <div className="mt-1 flex min-w-0 items-center gap-1">
            <div className="flex min-w-0 flex-1 items-center gap-0.5">
              {selected ? agentChip : <TargetPicker target={boardTarget} onPick={setBoardTarget} />}
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
              {live && (
                <PermissionPicker value={permission} onPick={(v) => (agent ? setOverride((o) => ({ ...o, permission: v })) : setAnyPermission(v))} />
              )}
            </div>
            <PixelSend disabled={!prompt.trim() || sending || mode === 'off'} busy={sending} />
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-0.5 px-0.5">
          {projectChip}
          <span role={floating ? undefined : 'status'} className={`ml-auto truncate pl-2 text-[11px] ${!floating && notice ? (notice.ok ? 'text-mint' : 'text-coral') : 'text-chalk-faint'}`}>
            {(!floating && notice?.text) || floorNote}
          </span>
        </div>
      </form>
    </div>
  );
}
