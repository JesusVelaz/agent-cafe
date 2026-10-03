'use client';

import { HARNESS, offeredModel, type AgentDTO, type ProviderId } from '@agent-cafe/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useModels } from '@/lib/models';
import type { ThemeChoice } from '@/lib/theme';
import type { ThemeId } from '@/scene/atmosphere';
import { useCafe } from '@/store/cafe';
import { AddProjectDialog } from './AddProjectDialog';
import { Avatar } from './Avatar';
import { THEME_LABELS, ThemeIcon } from './ThemePicker';
import { ModelList } from './pickers';
import { Caret, FolderIcon, HarnessIcon, Popover } from './ui';

export type Section = 'general' | 'agents' | 'providers' | 'projects';

const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'providers', label: 'Providers' },
  { id: 'projects', label: 'Projects' },
];

/** App settings in a modal: general, providers (connect Claude / ChatGPT, floor modes) and projects. */
export function SettingsDialog({
  open,
  onClose,
  initial = 'general',
  themeChoice,
  theme,
  onTheme,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Section;
  themeChoice: ThemeChoice;
  theme: ThemeId;
  onTheme: (c: ThemeChoice) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [section, setSection] = useState<Section>(initial);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setSection(initial);
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open, initial]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose(); // click on the backdrop
      }}
      aria-label="Settings"
      className="m-auto w-[min(760px,calc(100vw-2rem))] rounded-2xl border border-slate-line bg-night-2 p-0 text-chalk shadow-[0_30px_80px_rgba(0,0,0,.55)] transition-[opacity,scale] duration-200 backdrop:bg-black/50 backdrop:backdrop-blur-[2px] starting:scale-95 starting:opacity-0"
    >
      <div className="grid h-[min(560px,calc(100dvh-4rem))] grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5 border-r border-slate-line p-3">
          <h2 className="px-2.5 pb-3 pt-1 font-display text-[26px] font-normal leading-none">Settings</h2>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={section === s.id ? 'page' : undefined}
              onClick={() => setSection(s.id)}
              className={`rounded-lg px-2.5 py-2 text-left text-[13px] ${section === s.id ? 'bg-slate text-chalk' : 'text-chalk-dim hover:bg-slate hover:text-chalk'}`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="scroll-chalk relative min-h-0 overflow-y-auto p-6">
          <button
            type="button"
            aria-label="Close settings"
            onClick={onClose}
            className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-chalk-dim hover:bg-slate hover:text-chalk"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3 3l8 8M11 3l-8 8" /></svg>
          </button>
          {section === 'general' && <General themeChoice={themeChoice} theme={theme} onTheme={onTheme} />}
          {section === 'agents' && <Agents />}
          {section === 'providers' && <Providers active={open} />}
          {section === 'projects' && <Projects />}
        </div>
      </div>
    </dialog>
  );
}

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-5 pr-10">
      <h3 className="text-[18px] font-semibold">{title}</h3>
      {children && <p className="mt-1 text-[13px] text-chalk-dim">{children}</p>}
    </div>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-slate-line py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[13px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[12px] text-chalk-faint">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ── General ──────────────────────────────────────────────────────────────────

function General({ themeChoice, theme, onTheme }: { themeChoice: ThemeChoice; theme: ThemeId; onTheme: (c: ThemeChoice) => void }) {
  const settings = useCafe((s) => s.settings);
  const choices: ThemeChoice[] = ['auto', 'day', 'summer', 'rain', 'snow', 'night'];
  return (
    <>
      <Heading title="General" />
      <div className="border-b border-slate-line pb-4">
        <p className="text-[13px] font-medium">Café theme</p>
        <p className="mt-0.5 text-[12px] text-chalk-faint">Auto follows your local time and season.</p>
        <div role="radiogroup" aria-label="Café theme" className="mt-3 grid grid-cols-3 gap-2">
          {choices.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={themeChoice === c}
              onClick={() => onTheme(c)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
                themeChoice === c ? 'border-accent bg-slate text-chalk' : 'border-slate-line text-chalk-dim hover:bg-slate hover:text-chalk'
              }`}
            >
              <ThemeIcon theme={c === 'auto' ? theme : c} />
              {c === 'auto' ? `Auto (${THEME_LABELS[theme]})` : THEME_LABELS[c]}
            </button>
          ))}
        </div>
      </div>
      <Row label="Demo traffic" hint="Idle agents on demo floors pick up sample tasks by themselves. Never runs live.">
        <Toggle checked={settings.ambient} onChange={(on) => void api.updateSettings({ ambient: on })} label="Demo traffic" />
      </Row>
    </>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (on: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-slate-line'}`}
    >
      <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${checked ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
  );
}

// ── Agents ───────────────────────────────────────────────────────────────────

function Agents() {
  const agents = useCafe((s) => s.agents);
  const floors: ProviderId[] = ['anthropic', 'openai'];
  return (
    <>
      <Heading title="Agents">
        Rename your agents, change how they look, and pick the model each one uses by default. You can still pick a
        different model for any message.
      </Heading>
      <div className="flex flex-col gap-6">
        {floors.map((f) => {
          const crew = Object.values(agents)
            .filter((a) => a.providerId === f)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
          return (
            <section key={f} aria-label={FLOOR_LABEL[f]}>
              <p className="mb-2 flex items-center gap-2 text-[12px] text-chalk-faint">
                <HarnessIcon harness={HARNESS[f].id} />
                {FLOOR_LABEL[f]} · {HARNESS[f].name}
              </p>
              <div className="flex flex-col gap-2">
                {crew.map((a) => (
                  <AgentRow key={a.id} agent={a} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

/** Twelve looks to choose from: the current one first, then eleven others (Shuffle for more). */
function lookChoices(seed: number, page: number): number[] {
  const out = [seed];
  let x = (seed * 2654435761 + page * 97531) >>> 0;
  while (out.length < 12) {
    x = (Math.imul(x ^ (x >>> 15), 2246822507) + 3266489909) >>> 0;
    const next = (x % 999_998) + 1;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

function AgentRow({ agent }: { agent: AgentDTO }) {
  const models = useModels(agent.providerId);
  const [name, setName] = useState(agent.name);
  const [picking, setPicking] = useState(false);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(agent.name), [agent.name]);

  const save = (patch: Parameters<typeof api.updateAgent>[1]) => {
    setError(null);
    api.updateAgent(agent.id, patch).catch((e: Error) => setError(e.message.replace(/^name: /, '')));
  };
  const commitName = () => {
    const n = name.trim();
    if (!n) return setName(agent.name);
    if (n !== agent.name) save({ name: n });
  };
  const current = offeredModel(models, agent.model);
  // The seed the grid was built from stays put while you try looks, so the options don't jump.
  const [base, setBase] = useState(agent.spriteSeed);
  const choices = lookChoices(base, page);

  return (
    <div className="rounded-xl border border-slate-line bg-slate">
      <div className="flex items-center gap-3 p-3">
        <button
          type="button"
          aria-label={`Change ${agent.name}'s look`}
          aria-expanded={picking}
          onClick={() => {
            setBase(agent.spriteSeed);
            setPage(0);
            setPicking((p) => !p);
          }}
          className={`grid size-12 shrink-0 place-items-center rounded-lg bg-night-2 ${picking ? 'ring-2 ring-accent' : 'hover:ring-1 hover:ring-slate-line'}`}
        >
          <Avatar seed={agent.spriteSeed} providerId={agent.providerId} scale={3} />
        </button>
        <label className="sr-only" htmlFor={`name-${agent.id}`}>Name</label>
        <input
          id={`name-${agent.id}`}
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              // Undo the edit without closing Settings.
              e.preventDefault();
              setName(agent.name);
            }
          }}
          className="h-9 w-40 min-w-0 rounded-lg border border-transparent bg-transparent px-2 font-display text-[22px] leading-none text-chalk outline-none hover:border-slate-line focus:border-accent focus:bg-night-2"
        />
        {/* The same list as the composer's model picker; agents stay on their own floor. */}
        <div className="min-w-0 flex-1">
          <Popover
            label={`${agent.name}'s model`}
            side="auto"
            align="end"
            className="w-[320px]"
            trigger={({ open, toggle }) => (
              <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-label={`Model: ${current ? current.label : 'Choose model'}`}
                className={`flex h-9 w-full items-center gap-2 rounded-full border bg-night-2 pl-3.5 pr-4 text-left text-[13px] text-chalk transition-colors ${
                  open ? 'border-accent' : 'border-slate-line hover:border-chalk-faint'
                }`}
              >
                <HarnessIcon harness={HARNESS[agent.providerId].id} />
                <span className="min-w-0 flex-1 truncate">
                  {current ? current.label : 'Choose model'}
                  {current?.tag && <span className="text-chalk-faint"> · {current.tag}</span>}
                </span>
                <Caret />
              </button>
            )}
          >
            {(close) => (
              <ModelList
                initial={agent.providerId}
                model={agent.model}
                lockedTo={agent.providerId}
                onPick={(_p, m) => {
                  close();
                  if (m !== agent.model) save({ model: m });
                }}
              />
            )}
          </Popover>
        </div>
      </div>

      {picking && (
        <div className="border-t border-slate-line p-3">
          <div role="radiogroup" aria-label={`${agent.name}'s look`} className="grid grid-cols-6 gap-2">
            {choices.map((seed, i) => {
              const on = seed === agent.spriteSeed;
              return (
                <button
                  key={seed}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={i === 0 && seed === base ? 'Current look' : `Look ${i + 1}`}
                  onClick={() => save({ spriteSeed: seed })}
                  className={`grid aspect-square place-items-center rounded-lg ${on ? 'bg-slate-2 ring-2 ring-accent' : 'bg-night-2 hover:bg-slate-2'}`}
                >
                  <Avatar seed={seed} providerId={agent.providerId} scale={3} />
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="text-[12px] text-chalk-faint">
              {agent.providerId === 'openai' ? 'Ground floor agents wear casual clothes.' : 'Upstairs agents wear office clothes.'}
            </p>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setPage((n) => n + 1)} className="h-8 rounded-lg border border-slate-line px-3 text-[12px] text-chalk-dim hover:bg-slate-2 hover:text-chalk">
                Shuffle
              </button>
              <button type="button" onClick={() => setPicking(false)} className="h-8 rounded-lg bg-accent px-3 text-[12px] font-medium text-white hover:bg-[#7f9bff]">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {error && <p role="alert" className="px-3 pb-3 text-[12px] text-coral">{error}</p>}
    </div>
  );
}

// ── Providers ────────────────────────────────────────────────────────────────

function Providers({ active }: { active: boolean }) {
  return (
    <>
      <Heading title="Providers">
        Connect the accounts your agents work with. Signing in happens in the provider’s own app; Agent Café never sees your password or tokens.
      </Heading>
      <div className="flex flex-col gap-3">
        <ProviderCard id="anthropic" active={active} />
        <ProviderCard id="openai" active={active} />
      </div>
    </>
  );
}

const FLOOR_ROLE: Record<ProviderId, string> = { anthropic: 'runs upstairs', openai: 'runs the ground floor' };
const FLOOR_LABEL: Record<ProviderId, string> = { anthropic: 'Upstairs', openai: 'Ground floor' };

const WINDOW_NAME: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly Opus limit',
  seven_day_sonnet: 'Weekly Sonnet limit',
};

/** A connected provider has one switch: on runs live on your plan, off runs demo tasks. */
function ProviderCard({ id, active }: { id: ProviderId; active: boolean }) {
  const p = useCafe((s) => s.providers[id]);
  const h = HARNESS[id];
  const c = p?.connection;
  const [waiting, setWaiting] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const connected = c?.state === 'ready';
  const live = p?.mode === 'live';
  const floor = FLOOR_LABEL[id];

  // After "Connect" the server watches for the sign-in and pushes the change; this only clears the note.
  useEffect(() => {
    if (connected) setWaiting(false);
  }, [connected]);
  // Opening Settings re-checks each provider: its sign-in, and its plan usage bar.
  useEffect(() => {
    if (active && c && c.state !== 'checking') void api.checkProvider(id).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [active, id]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setMode = (mode: 'live' | 'mock') => run(() => api.updateProvider(id, { mode }));

  // Until the first check answers it reads as not connected: that's usually right, and it flips the moment it isn't.
  const status = connected
    ? { text: 'Connected', tone: 'text-mint' }
    : c?.state === 'not_installed'
      ? { text: 'Not installed', tone: 'text-coral' }
      : c?.state === 'error'
        ? { text: 'Couldn’t reach it', tone: 'text-coral' }
        : c?.state === 'unsupported'
          ? { text: 'Update needed', tone: 'text-amber' }
          : { text: 'Not connected', tone: 'text-chalk-faint' };
  // A floor left on Live (or the old Off) without an account can't take tasks; offer the way back to demo.
  const stranded = !connected && p !== undefined && p.mode !== 'mock';
  const note = connected
    ? !h.live
      ? `Live ${h.name} runs are coming next. ${floor} agents run demo tasks for now.`
      : live
        ? `${floor} agents run real tasks on your ${h.account} plan.`
        : `Off: ${floor.toLowerCase()} agents run demo tasks. Turn on to use your ${h.account} plan.`
    : stranded
      ? `${floor} is set to ${live ? 'Live' : 'closed'}, so its agents can’t take tasks until you connect.`
      : c?.state === 'unsupported'
        ? `${floor} agents run demo tasks until you update ${h.name}.`
        : `${floor} agents run demo tasks until you connect ${h.account}.`;
  const pct = p?.usage?.utilization != null ? Math.round(p.usage.utilization * 100) : null;

  return (
    <section aria-label={h.account} className="rounded-xl border border-slate-line bg-slate p-4">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-night-2">
          <HarnessIcon harness={h.id} size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-semibold">{h.account}</p>
            <span className={`text-[12px] ${status.tone}`}>● {status.text}</span>
          </div>
          <p className="mt-0.5 truncate text-[12px] text-chalk-faint">
            {[`${h.name}${c?.version ? ` ${c.version}` : ''}`, connected ? [c?.account, c?.plan].filter(Boolean).join(' · ') : null, FLOOR_ROLE[id]]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="shrink-0">
          {connected ? (
            <Toggle
              checked={live && h.live}
              disabled={busy || !h.live}
              onChange={(on) => setMode(on ? 'live' : 'mock')}
              label={`Use ${h.account} for live runs`}
            />
          ) : c?.state === 'not_installed' ? (
            <a
              href={id === 'anthropic' ? 'https://code.claude.com' : 'https://developers.openai.com/codex'}
              target="_blank"
              rel="noreferrer"
              className="grid h-8 place-items-center rounded-lg bg-accent px-3.5 text-[13px] font-medium text-white hover:bg-[#7f9bff]"
            >
              Install {h.name}
            </a>
          ) : c?.state === 'unsupported' ? null : (
            <button
              type="button"
              disabled={busy || waiting}
              onClick={() => run(async () => {
                const r = await api.connectProvider(id);
                if (!r.connected) setWaiting(true);
              })}
              className="h-8 rounded-lg bg-accent px-3.5 text-[13px] font-medium text-white hover:bg-[#7f9bff] disabled:opacity-60"
            >
              {waiting ? 'Waiting' : 'Connect'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className={`text-[12px] ${stranded ? 'text-amber' : 'text-chalk-dim'}`}>{note}</p>
        {stranded && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setMode('mock')}
            className="h-8 shrink-0 rounded-lg border border-slate-line px-3 text-[13px] text-chalk-dim hover:bg-slate-2 hover:text-chalk disabled:opacity-50"
          >
            Use demo
          </button>
        )}
      </div>

      {waiting && !connected && (
        <p className="mt-3 rounded-lg bg-night-2 px-3 py-2 text-[12px] text-chalk-dim">
          Finish signing in to {h.account} in the terminal window that just opened (it may open your browser). This card updates by itself when you’re done, even if you close Settings.
        </p>
      )}
      {error && <p role="alert" className="mt-3 text-[12px] text-coral">{error}</p>}
      {(c?.state === 'error' || c?.state === 'unsupported') && c.message && <p className="mt-3 text-[12px] text-coral">{c.message}</p>}

      {pct !== null && (
        <div className="mt-3" title={p?.usage?.resetsAt ? `Resets ${new Date(p.usage.resetsAt).toLocaleString()}` : undefined}>
          <div className="mb-1 flex justify-between text-[11px] text-chalk-faint">
            <span>{WINDOW_NAME[p!.usage!.window ?? ''] ?? 'Plan usage'}</span>
            <span>{pct}% used</span>
          </div>
          <div className="h-1.5 rounded-full bg-night-2">
            <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--color-coral)' : pct >= 70 ? 'var(--color-amber)' : 'var(--color-mint)' }} />
          </div>
        </div>
      )}

      {connected && (
        <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-slate-line pt-3">
          {confirmOut ? (
            <>
              <span className="mr-1 text-[12px] text-chalk-dim">Sign out of {h.name} on this computer? Your terminal sessions sign out too.</span>
              <button
                type="button"
                onClick={() => setConfirmOut(false)}
                className="h-8 shrink-0 rounded-lg border border-slate-line px-3 text-[13px] text-chalk-dim hover:bg-slate-2 hover:text-chalk"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(async () => {
                  await api.disconnectProvider(id);
                  // Without the account a live floor can't run; fall back to demo like a fresh install.
                  if (live) await api.updateProvider(id, { mode: 'mock' });
                  setConfirmOut(false);
                })}
                className="h-8 shrink-0 rounded-lg border border-[#5a3128] bg-[#2a1915] px-3 text-[13px] text-coral hover:bg-[#3a1f1a] disabled:opacity-50"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmOut(true)}
              className="h-8 rounded-lg border border-slate-line px-3 text-[13px] text-chalk-dim hover:border-[#5a3128] hover:bg-[#231817] hover:text-coral"
            >
              Sign out
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// ── Projects ─────────────────────────────────────────────────────────────────

function Projects() {
  const projects = useCafe((s) => s.projects);
  const list = Object.values(projects).sort((a, b) => a.name.localeCompare(b.name));
  const [adding, setAdding] = useState(false);
  return (
    <>
      <Heading title="Projects">Folders your agents work in. Add one once, then pick it by name under the message box.</Heading>
      <div className="flex flex-col gap-1.5">
        {list.length === 0 && <p className="rounded-lg border border-dashed border-slate-line px-3 py-4 text-center text-[13px] text-chalk-faint">No projects yet.</p>}
        {list.map((p) => (
          <ProjectRow key={p.id} id={p.id} name={p.name} path={p.path} />
        ))}
      </div>
      <button type="button" onClick={() => setAdding(true)} className="mt-4 h-9 rounded-lg bg-accent px-4 text-[13px] font-medium text-white hover:bg-[#7f9bff]">
        Add project
      </button>
      <p className="mt-1.5 text-[12px] text-chalk-faint">Browse to a folder on this computer, or clone a Git or GitHub repository.</p>
      <AddProjectDialog open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function ProjectRow({ id, name, path }: { id: string; name: string; path: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const save = () => {
    setEditing(false);
    if (value.trim() && value.trim() !== name) void api.renameProject(id, value.trim());
    else setValue(name);
  };
  return (
    <div className="group flex items-center gap-3 rounded-lg border border-slate-line bg-slate px-3 py-2">
      <FolderIcon size={16} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            aria-label="Project name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') {
                setValue(name);
                setEditing(false);
              }
            }}
            className="h-6 w-full rounded border border-accent bg-night-2 px-1.5 text-[13px] outline-none"
          />
        ) : (
          <p className="truncate text-[13px] font-medium">{name}</p>
        )}
        <p className="truncate font-mono text-[11px] text-chalk-faint">{path}</p>
      </div>
      <button type="button" onClick={() => setEditing(true)} className="rounded-md px-2 py-1 text-[12px] text-chalk-dim hover:bg-slate-2 hover:text-chalk">Rename</button>
      <button
        type="button"
        onClick={() => void api.removeProject(id)}
        title="Removes it from the list; the folder is untouched"
        className="rounded-md px-2 py-1 text-[12px] text-chalk-dim hover:bg-slate-2 hover:text-coral"
      >
        Remove
      </button>
    </div>
  );
}
