'use client';

import type { ProjectDTO } from '@agent-cafe/shared';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type FolderListing } from '@/lib/api';
import { useCafe } from '@/store/cafe';
import { FolderIcon } from './ui';

type Screen =
  | { kind: 'sources' }
  | { kind: 'browse'; purpose: 'add' | 'cloneInto' }
  | { kind: 'clone'; source: 'git' | 'github' };

const SOURCES = [
  { id: 'local', title: 'Local folder', hint: 'Browse a folder on disk' },
  { id: 'git', title: 'Git URL', hint: 'Clone from a remote URL' },
  { id: 'github', title: 'GitHub repository', hint: 'Clone GitHub owner/repo' },
] as const;

const DRIVES_DISPLAY = 'This PC/';

/**
 * "Add project" as a command palette: pick a source, then browse to a folder (typing
 * a path jumps and filters) or clone a repository into one. Keyboard first:
 * ↑↓ move, Enter picks, Backspace steps back, Esc closes.
 */
export function AddProjectDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded?: (p: ProjectDTO) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'sources' });
  const [cloneInto, setCloneInto] = useState('~/');

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setScreen({ kind: 'sources' });
      d.showModal();
    } else if (!open && d.open) d.close();
  }, [open]);

  const added = (p: ProjectDTO) => {
    useCafe.getState().apply({ type: 'project.upserted', project: p });
    onAdded?.(p);
    onClose();
  };

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      aria-label="Add project"
      className="mx-auto mt-[12vh] w-[min(600px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-slate-line bg-night-2 p-0 text-chalk shadow-[0_30px_80px_rgba(0,0,0,.6)] transition-[opacity,scale] duration-150 backdrop:bg-black/55 starting:scale-[.98] starting:opacity-0"
    >
      {open && screen.kind === 'sources' && (
        <Sources
          onPick={(id) => setScreen(id === 'local' ? { kind: 'browse', purpose: 'add' } : { kind: 'clone', source: id })}
        />
      )}
      {open && screen.kind === 'browse' && (
        <Browser
          start={screen.purpose === 'cloneInto' ? cloneInto : '~/'}
          actionLabel={screen.purpose === 'add' ? 'Add' : 'Clone here'}
          onBack={() => setScreen(screen.purpose === 'add' ? { kind: 'sources' } : { kind: 'clone', source: lastClone.current })}
          onChoose={async (listing) => {
            if (screen.purpose === 'add') added(await api.addProject({ path: listing.path }));
            else {
              setCloneInto(listing.display);
              setScreen({ kind: 'clone', source: lastClone.current });
            }
          }}
        />
      )}
      {open && screen.kind === 'clone' && (
        <Clone
          source={screen.source}
          into={cloneInto}
          onBack={() => setScreen({ kind: 'sources' })}
          onChangeFolder={() => {
            lastClone.current = screen.source;
            setScreen({ kind: 'browse', purpose: 'cloneInto' });
          }}
          onCloned={added}
        />
      )}
    </dialog>
  );
}

// Which clone screen to return to after picking its folder.
const lastClone = { current: 'git' as 'git' | 'github' };

// ── Pieces ───────────────────────────────────────────────────────────────────

function Header({ onBack, children, action }: { onBack?: () => void; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-slate-line px-3 py-2.5">
      {onBack ? (
        <button type="button" aria-label="Back" onClick={onBack} className="grid size-8 shrink-0 place-items-center rounded-lg text-chalk-dim hover:bg-slate hover:text-chalk">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M13 8H3M7 4L3 8l4 4" /></svg>
        </button>
      ) : (
        <span className="grid size-8 shrink-0 place-items-center text-chalk-faint" aria-hidden>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></svg>
        </span>
      )}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

function Keys({ hints, right }: { hints: Array<[string[], string]>; right?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-slate-line bg-night px-4 py-2.5 text-[12px] text-chalk-faint">
      {hints.map(([keys, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          {keys.map((k) => (
            <kbd key={k} className="rounded-md border border-slate-line bg-slate px-1.5 py-0.5 font-sans text-[11px] text-chalk-dim">{k}</kbd>
          ))}
          {label}
        </span>
      ))}
      {right && <span className="ml-auto">{right}</span>}
    </div>
  );
}

const inputClass = 'h-9 w-full bg-transparent text-[14px] text-chalk outline-none placeholder:text-chalk-faint';

function Row({ active, onClick, onHover, icon, title, hint }: { active: boolean; onClick: () => void; onHover: () => void; icon: ReactNode; title: string; hint?: string }) {
  const el = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) el.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <button
      ref={el}
      type="button"
      onClick={onClick}
      onMouseMove={onHover}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${active ? 'bg-slate-2' : ''}`}
    >
      <span className="shrink-0 text-chalk-dim">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[14px] text-chalk">{title}</span>
        {hint && <span className="block truncate text-[12px] text-chalk-faint">{hint}</span>}
      </span>
    </button>
  );
}

function SourceIcon({ id }: { id: (typeof SOURCES)[number]['id'] }) {
  if (id === 'local') return <FolderIcon size={18} />;
  if (id === 'git')
    return (
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
        <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8" />
      </svg>
    );
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 1a7 7 0 0 0-2.2 13.6c.35.07.48-.15.48-.34v-1.2c-1.95.43-2.36-.94-2.36-.94-.32-.81-.78-1.03-.78-1.03-.64-.44.05-.43.05-.43.7.05 1.07.72 1.07.72.63 1.07 1.64.76 2.04.58.06-.45.24-.76.44-.94-1.55-.18-3.19-.78-3.19-3.47 0-.77.27-1.39.72-1.88-.07-.18-.31-.89.07-1.86 0 0 .59-.19 1.93.72a6.6 6.6 0 0 1 3.5 0c1.34-.91 1.93-.72 1.93-.72.38.97.14 1.68.07 1.86.45.49.72 1.11.72 1.88 0 2.7-1.64 3.29-3.2 3.46.25.22.47.64.47 1.29v1.92c0 .19.13.41.48.34A7 7 0 0 0 8 1z" />
    </svg>
  );
}

// ── Sources ──────────────────────────────────────────────────────────────────

function Sources({ onPick }: { onPick: (id: (typeof SOURCES)[number]['id']) => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const shown = SOURCES.filter((s) => `${s.title} ${s.hint}`.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => setActive(0), [q]);
  return (
    <>
      <Header>
        <input
          autoFocus
          aria-label="Search sources"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, shown.length - 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
            else if (e.key === 'Enter' && shown[active]) (e.preventDefault(), onPick(shown[active].id));
          }}
          placeholder="Search…"
          className={inputClass}
        />
      </Header>
      <div className="px-2 py-2">
        <p className="px-3 pb-1 pt-1 text-[12px] text-chalk-faint">Sources</p>
        {shown.map((s, i) => (
          <Row key={s.id} active={i === active} onHover={() => setActive(i)} onClick={() => onPick(s.id)} icon={<SourceIcon id={s.id} />} title={s.title} hint={s.hint} />
        ))}
        {shown.length === 0 && <p className="px-3 py-3 text-[13px] text-chalk-faint">No sources match.</p>}
      </div>
      <Keys hints={[[['↑', '↓'], 'Navigate'], [['Enter'], 'Select'], [['Esc'], 'Close']]} />
    </>
  );
}

// ── Folder browser ───────────────────────────────────────────────────────────

/** Splits "~/projects/we" into the folder to list ("~/projects/") and the filter ("we"). */
function splitPath(text: string): { dir: string; filter: string } {
  const i = text.lastIndexOf('/');
  return i < 0 ? { dir: '~/', filter: text } : { dir: text.slice(0, i + 1), filter: text.slice(i + 1) };
}

function Browser({
  start,
  actionLabel,
  onBack,
  onChoose,
}: {
  start: string;
  actionLabel: string;
  onBack: () => void;
  onChoose: (l: FolderListing) => Promise<void>;
}) {
  const [text, setText] = useState(start);
  const [listing, setListing] = useState<FolderListing | null>(null);
  /** The typed folder the current listing belongs to (a listing can lag a keystroke behind). */
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);
  const { dir, filter } = splitPath(text);
  const input = useRef<HTMLInputElement>(null);

  // List the typed folder (debounced a little so typing a path doesn't flood the server).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .folders(dir === DRIVES_DISPLAY ? '::drives' : dir)
        .then((l) => {
          if (cancelled) return;
          setListing(l);
          setLoadedFor(dir);
          setError(null);
        })
        .catch((e: Error) => {
          if (cancelled) return;
          setError(e.message);
          setLoadedFor(null);
        });
    }, 90);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [dir]);

  const shown = useMemo(() => {
    const all = listing?.entries ?? [];
    const f = filter.toLowerCase();
    if (!f) return all;
    const starts = all.filter((e) => e.name.toLowerCase().startsWith(f));
    const has = all.filter((e) => !e.name.toLowerCase().startsWith(f) && e.name.toLowerCase().includes(f));
    return [...starts, ...has];
  }, [listing, filter]);
  useEffect(() => setActive(filter ? 0 : -1), [filter, listing]);

  const openEntry = (name: string) => {
    setText(`${listing?.display ?? dir}${name}/`);
    input.current?.focus();
  };
  const goUp = () => {
    if (listing?.parentDisplay) setText(listing.parentDisplay);
    else onBack();
  };
  const choose = async () => {
    if (!listing || listing.path === '::drives' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onChoose(listing);
    } catch (e) {
      setError((e as Error).message.replace(/^path: /, ''));
    } finally {
      setBusy(false);
    }
  };
  const current = Boolean(listing) && !error && loadedFor === dir;

  return (
    <>
      <Header
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => void choose()}
            disabled={!current || busy || listing?.path === '::drives'}
            className="flex h-8 shrink-0 items-center gap-2 rounded-lg border border-slate-line bg-slate pl-3 pr-1.5 text-[13px] font-medium text-chalk hover:bg-slate-2 disabled:opacity-40"
          >
            {busy ? 'Adding' : actionLabel}
            <kbd className="rounded-md bg-night px-1.5 py-0.5 font-sans text-[11px] font-normal text-chalk-faint">Enter</kbd>
          </button>
        }
      >
        <input
          ref={input}
          autoFocus
          aria-label="Folder path"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value.replace(/\\/g, '/'))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(a + 1, shown.length - 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(a - 1, -1)));
            else if ((e.key === 'Tab' || e.key === 'ArrowRight') && shown[Math.max(active, 0)] && (filter || active >= 0)) {
              e.preventDefault();
              openEntry(shown[Math.max(active, 0)]!.name);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              // A highlighted folder opens; otherwise Enter picks the folder you're in.
              if (active >= 0 && shown[active]) openEntry(shown[active].name);
              else void choose();
            } else if (e.key === 'Backspace' && !filter && e.currentTarget.selectionStart === text.length) {
              e.preventDefault();
              goUp();
            }
          }}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </Header>
      <div className="scroll-chalk h-[min(340px,50vh)] overflow-y-auto px-2 py-2">
        <p className="px-3 pb-1 pt-1 text-[12px] text-chalk-faint">{listing?.path === '::drives' ? 'Drives' : 'Folders'}</p>
        {error && <p role="alert" className="px-3 py-2 text-[13px] text-coral">{error}</p>}
        {!error &&
          shown.map((e, i) => (
            <Row key={e.path} active={i === active} onHover={() => setActive(i)} onClick={() => openEntry(e.name)} icon={<FolderIcon size={16} />} title={e.name} />
          ))}
        {!error && listing && shown.length === 0 && (
          <p className="px-3 py-3 text-[13px] text-chalk-faint">{filter ? 'No folders match.' : 'No folders in here.'}</p>
        )}
      </div>
      <Keys
        hints={[[['↑', '↓'], 'Navigate'], [['Tab'], 'Open'], [['Backspace'], 'Up'], [['Esc'], 'Close']]}
        right={
          listing && listing.path !== '::drives' ? (
            <button type="button" onClick={() => void api.revealFolder(listing.path)} className="text-chalk-faint hover:text-chalk">
              Open in {typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'Finder' : 'Explorer'}
            </button>
          ) : null
        }
      />
    </>
  );
}

// ── Clone ────────────────────────────────────────────────────────────────────

function toUrl(source: 'git' | 'github', value: string): string | null {
  const v = value.trim();
  if (source === 'git') return /^(https:\/\/|ssh:\/\/|git@[\w.-]+:)\S+$/.test(v) ? v : null;
  const m = v.match(/^(?:https:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}.git` : null;
}

const nameFrom = (url: string) => (url.replace(/\/+$/, '').split(/[/:]/).pop() ?? '').replace(/\.git$/i, '');

function Clone({
  source,
  into,
  onBack,
  onChangeFolder,
  onCloned,
}: {
  source: 'git' | 'github';
  into: string;
  onBack: () => void;
  onChangeFolder: () => void;
  onCloned: (p: ProjectDTO) => void;
}) {
  const [value, setValue] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = toUrl(source, value);
  useEffect(() => {
    if (!nameEdited) setName(url ? nameFrom(url) : '');
  }, [url, nameEdited]);

  const clone = async () => {
    if (!url || busy) return;
    setBusy(true);
    setError(null);
    try {
      onCloned(await api.cloneProject({ url, parent: into, ...(name.trim() ? { name: name.trim() } : {}) }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Header
        onBack={onBack}
        action={
          <button
            type="button"
            onClick={() => void clone()}
            disabled={!url || busy}
            className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-accent pl-3 pr-1.5 text-[13px] font-medium text-white hover:bg-[#7f9bff] disabled:opacity-40"
          >
            {busy ? 'Cloning' : 'Clone'}
            <kbd className="rounded-md bg-accent-dark px-1.5 py-0.5 font-sans text-[11px] font-normal text-white/80">Enter</kbd>
          </button>
        }
      >
        <input
          autoFocus
          aria-label={source === 'github' ? 'GitHub repository (owner/repo)' : 'Git URL'}
          spellCheck={false}
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.preventDefault(), void clone());
            else if (e.key === 'Backspace' && !value) (e.preventDefault(), onBack());
          }}
          placeholder={source === 'github' ? 'owner/repo' : 'https://github.com/owner/repo.git'}
          className={`${inputClass} font-mono text-[13px]`}
        />
      </Header>
      <div className="flex flex-col gap-1 px-4 py-4">
        <div className="flex items-center justify-between gap-4 rounded-lg px-1 py-2">
          <div className="min-w-0">
            <p className="text-[13px] text-chalk">Clone into</p>
            <p className="truncate font-mono text-[12px] text-chalk-faint">{into}{name || '…'}/</p>
          </div>
          <button type="button" onClick={onChangeFolder} disabled={busy} className="h-8 shrink-0 rounded-lg border border-slate-line px-3 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk">
            Change folder
          </button>
        </div>
        <label className="flex items-center justify-between gap-4 rounded-lg px-1 py-2">
          <span className="text-[13px] text-chalk">Folder name</span>
          <input
            value={name}
            disabled={busy}
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(true);
            }}
            spellCheck={false}
            className="h-8 w-56 rounded-lg border border-slate-line bg-slate px-2.5 font-mono text-[12px] text-chalk outline-none focus:border-accent"
          />
        </label>
        {value && !url && (
          <p className="px-1 text-[12px] text-amber">{source === 'github' ? 'Use owner/repo, like acme/web.' : 'Use an https:// or git@ URL.'}</p>
        )}
        {busy && <p className="px-1 text-[12px] text-chalk-dim">Cloning… large repositories can take a minute.</p>}
        {error && <p role="alert" className="px-1 text-[12px] text-coral">{error}</p>}
        <p className="px-1 pt-1 text-[12px] text-chalk-faint">
          Private repositories use the Git credentials already on this computer{source === 'github' ? ' (e.g. from GitHub Desktop or the gh CLI)' : ''}.
        </p>
      </div>
      <Keys hints={[[['Enter'], 'Clone'], [['Backspace'], 'Back'], [['Esc'], 'Close']]} />
    </>
  );
}
