'use client';

import { HARNESS, PROVIDER_IDS, offeredModel, type AgentPermission, type ProviderId } from '@agent-cafe/shared';
import { useId, useState } from 'react';
import { api } from '@/lib/api';
import { FLOOR_NAME } from '@/lib/format';
import { modelLabel, useModels, useModelOptions } from '@/lib/models';
import { useCafe } from '@/store/cafe';
import { AddProjectDialog } from './AddProjectDialog';
import { Avatar } from './Avatar';
import { Caret, Chip, FolderIcon, HarnessIcon, Popover } from './ui';

/**
 * Harness rail on the left, that harness's models on the right (like t3code).
 * `lockedTo` keeps the choice on one floor, when messaging a specific agent.
 */
export function ModelPicker({
  provider,
  model,
  lockedTo,
  onPick,
}: {
  provider: ProviderId;
  model: string;
  lockedTo?: ProviderId;
  onPick: (provider: ProviderId, model: string) => void;
}) {
  const models = useModels(provider);
  return (
    <Popover
      label="Choose a model"
      className="w-[320px]"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open} label={`Model: ${modelLabel(models, model)}`}>
          <HarnessIcon harness={HARNESS[provider].id} />
          <span className="truncate">{offeredModel(models, model) ? modelLabel(models, model) : 'Choose model'}</span>
          <Caret />
        </Chip>
      )}
    >
      {(close) => <ModelList initial={provider} model={model} lockedTo={lockedTo} onPick={(p, m) => (onPick(p, m), close())} />}
    </Popover>
  );
}

/** The model list behind ModelPicker: a floor rail, search, and each model with its note. */
export function ModelList({
  initial,
  model,
  lockedTo,
  onPick,
}: {
  initial: ProviderId;
  model: string;
  lockedTo?: ProviderId;
  onPick: (p: ProviderId, m: string) => void;
}) {
  const [tab, setTab] = useState<ProviderId>(initial);
  const [q, setQ] = useState('');
  const { models, loading, error, refresh } = useModelOptions(tab);
  const demo = useCafe((s) => s.providers[tab]?.mode === 'mock');
  const searchId = useId();
  const shown = models.filter((m) => `${m.label} ${m.value}`.toLowerCase().includes(q.trim().toLowerCase()));
  // Upstairs first, like the café.
  const rail = [...PROVIDER_IDS].sort((a) => (a === 'anthropic' ? -1 : 1));
  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] overflow-hidden rounded-xl">
      <div className="flex flex-col items-center gap-1 border-r border-slate-line bg-night-2 py-2" role="tablist" aria-label="Harness">
        {rail.map((p) => {
          const locked = lockedTo !== undefined && lockedTo !== p;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={tab === p}
              aria-label={HARNESS[p].name}
              disabled={locked}
              title={locked ? `${HARNESS[p].name} agents work on the ${FLOOR_NAME[p].toLowerCase()}` : HARNESS[p].name}
              onClick={() => setTab(p)}
              className={`grid size-9 place-items-center rounded-lg disabled:opacity-30 ${tab === p ? 'bg-slate-2 shadow-[inset_2px_0_0_var(--color-accent)]' : 'hover:bg-slate-2'}`}
            >
              <HarnessIcon harness={HARNESS[p].id} size={16} />
            </button>
          );
        })}
      </div>
      <div className="flex max-h-80 flex-col p-1.5">
        <div className="mb-1 flex items-center justify-between px-2.5 text-[11px] text-chalk-faint">
          <span>{demo ? 'Demo models' : 'Available models'}</span>
          <button type="button" disabled={loading} onClick={refresh} className="text-mint disabled:opacity-40">Refresh</button>
        </div>
        <label htmlFor={searchId} className="sr-only">Search models</label>
        <input
          id={searchId}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Search ${HARNESS[tab].name} models`}
          className="mb-1 h-8 rounded-lg border border-slate-line bg-night-2 px-2.5 text-[12px] text-chalk placeholder:text-chalk-faint"
        />
        <div className="scroll-chalk flex flex-col overflow-y-auto">
          {shown.map((m) => {
            const on = tab === initial && m.value === offeredModel(models, model)?.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => onPick(tab, m.value)}
                className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left ${on ? 'bg-slate-2' : 'hover:bg-slate-2'}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-chalk">{m.label}</span>
                  <span className="block text-[11px] text-chalk-faint">
                    {[m.tag, m.description].filter(Boolean).join(' · ')}
                  </span>
                </span>
                {on && (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Selected" className="text-accent">
                    <path d="M2.5 7.5l3 3 6-7" />
                  </svg>
                )}
              </button>
            );
          })}
          {shown.length === 0 && <p role="status" className="px-2.5 py-3 text-[12px] text-chalk-faint">{loading ? 'Loading available models…' : error ?? 'No models match.'}</p>}
        </div>
      </div>
    </div>
  );
}

/** Pick a project by name, add one by pasting its folder, or remove one from the list. */
export function ProjectPicker({ projectId, onPick, required }: { projectId: string | null; onPick: (id: string | null) => void; required?: boolean }) {
  const projects = useCafe((s) => s.projects);
  const current = projectId ? projects[projectId] : undefined;
  const list = Object.values(projects).sort((a, b) => a.name.localeCompare(b.name));
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Popover
        label="Choose a project"
        className="w-[320px]"
        trigger={({ open, toggle }) => (
          <Chip onClick={toggle} active={open} label={`Project: ${current?.name ?? 'none'}`} title={current?.path}>
            <FolderIcon size={13} />
            <span className={`truncate ${!current && required ? 'text-amber' : ''}`}>{current?.name ?? (required ? 'Pick a project' : 'No project')}</span>
            <Caret />
          </Chip>
        )}
      >
        {(close) => (
          <div className="flex flex-col p-1.5">
            {list.length === 0 && <p className="px-2.5 pb-1 pt-2 text-[12px] text-chalk-faint">No projects yet. Add a folder, or clone a repository.</p>}
            {list.map((p) => (
              <div key={p.id} className={`group flex items-center rounded-lg ${p.id === projectId ? 'bg-slate-2' : 'hover:bg-slate-2'}`}>
                <button type="button" onClick={() => (onPick(p.id), close())} className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left">
                  <FolderIcon />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-chalk">{p.name}</span>
                    <span className="block truncate font-mono text-[11px] text-chalk-faint">{p.path}</span>
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${p.name} from the list`}
                  title="Remove from the list (the folder is untouched)"
                  onClick={() => {
                    if (p.id === projectId) onPick(null);
                    void api.removeProject(p.id);
                  }}
                  className="mr-1 grid size-7 shrink-0 place-items-center rounded-md text-chalk-faint opacity-0 hover:bg-slate-line hover:text-chalk focus:opacity-100 group-hover:opacity-100"
                >
                  ×
                </button>
              </div>
            ))}
            {!required && projectId && (
              <button type="button" onClick={() => (onPick(null), close())} className="rounded-lg px-2.5 py-1.5 text-left text-[12px] text-chalk-dim hover:bg-slate-2">
                No project (demo runs only)
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                close();
                setAdding(true);
              }}
              className="mt-1 flex items-center gap-2 rounded-lg border-t border-slate-line px-2.5 pb-1.5 pt-2 text-left text-[13px] text-chalk-dim hover:bg-slate-2 hover:text-chalk"
            >
              <span aria-hidden className="grid size-4 place-items-center text-[15px] leading-none">+</span>
              Add project
            </button>
          </div>
        )}
      </Popover>
      <AddProjectDialog open={adding} onClose={() => setAdding(false)} onAdded={(p) => onPick(p.id)} />
    </>
  );
}


const PERMISSIONS: Array<{ value: AgentPermission; label: string; hint: string }> = [
  { value: 'ask', label: 'Ask first', hint: 'Asks before editing files or running commands' },
  { value: 'acceptEdits', label: 'Auto-accept edits', hint: 'Edits files without asking; commands still ask' },
];

export function PermissionPicker({ value, onPick }: { value: AgentPermission; onPick: (p: AgentPermission) => void }) {
  const current = PERMISSIONS.find((p) => p.value === value)!;
  return (
    <Popover
      label="Permission"
      className="w-[260px]"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open} label={`Permission: ${current.label}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden className="shrink-0">
            <rect x="2.5" y="5.5" width="7" height="5" rx="1" />
            <path d={value === 'ask' ? 'M4 5.5V4a2 2 0 0 1 4 0v1.5' : 'M4 5.5V4a2 2 0 0 1 3.9-.6'} />
          </svg>
          <span className="truncate">{current.label}</span>
          <Caret />
        </Chip>
      )}
    >
      {(close) => (
        <div className="flex flex-col p-1.5">
          {PERMISSIONS.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => (onPick(p.value), close())}
              className={`rounded-lg px-2.5 py-1.5 text-left ${p.value === value ? 'bg-slate-2' : 'hover:bg-slate-2'}`}
            >
              <span className="block text-[13px] font-medium text-chalk">{p.label}</span>
              <span className="block text-[11px] text-chalk-faint">{p.hint}</span>
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

export type Target = { kind: 'any'; provider: ProviderId } | { kind: 'agent'; agentId: string };

/** Who gets the task on the board: whoever is free on a floor, or a named agent. */
export function TargetPicker({ target, onPick }: { target: Target; onPick: (t: Target) => void }) {
  const agents = useCafe((s) => s.agents);
  const crew = Object.values(agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const label = target.kind === 'any' ? `Anyone ${target.provider === 'anthropic' ? 'upstairs' : 'downstairs'}` : agents[target.agentId]?.name ?? 'Agent';
  const models = { anthropic: useModels('anthropic'), openai: useModels('openai') };
  const floors: ProviderId[] = ['anthropic', 'openai'];
  return (
    <Popover
      label="Send to"
      className="w-[260px]"
      trigger={({ open, toggle }) => (
        <Chip onClick={toggle} active={open} label={`Send to: ${label}`}>
          <span aria-hidden className="size-2 shrink-0 bg-mint" />
          <span className="truncate">{label}</span>
          <Caret />
        </Chip>
      )}
    >
      {(close) => (
        <div className="scroll-chalk flex max-h-80 flex-col overflow-y-auto p-1.5">
          {floors.map((p) => (
            <div key={p} className="flex flex-col">
              <button
                type="button"
                onClick={() => (onPick({ kind: 'any', provider: p }), close())}
                className="rounded-lg px-2.5 py-1.5 text-left text-[13px] font-medium text-chalk hover:bg-slate-2"
              >
                Anyone {p === 'anthropic' ? 'upstairs' : 'downstairs'}
                <span className="block text-[11px] font-normal text-chalk-faint">Whoever is free · {HARNESS[p].name}</span>
              </button>
              {crew
                .filter((a) => a.providerId === p)
                .map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => (onPick({ kind: 'agent', agentId: a.id }), close())}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-1 text-left text-[13px] text-chalk-dim hover:bg-slate-2 hover:text-chalk"
                  >
                    <Avatar seed={a.spriteSeed} providerId={a.providerId} scale={1.5} />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="shrink-0 text-[11px] text-chalk-faint">{modelLabel(models[a.providerId], a.model)}</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </Popover>
  );
}
