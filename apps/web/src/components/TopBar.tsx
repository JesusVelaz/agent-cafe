'use client';

import { DEFAULTS, HARNESS, type ProviderId, type ProviderMode, type ProviderStatusDTO } from '@agent-cafe/shared';
import { useState } from 'react';
import type { ThemeChoice } from '@/lib/theme';
import { api } from '@/lib/api';
import { FLOOR_NAME } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import type { ThemeId } from '@/scene/atmosphere';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';
import { ThemePicker } from './ThemePicker';
import { Caret, HarnessIcon, Popover } from './ui';

const MODES: Array<{ mode: ProviderMode; label: string; hint: string }> = [
  { mode: 'live', label: 'Live', hint: 'Runs on your subscription' },
  { mode: 'mock', label: 'Demo', hint: 'Scripted runs, no real calls' },
  { mode: 'off', label: 'Off', hint: 'Refuses new tasks' },
];
const MODE_TONE: Record<ProviderMode, string> = { live: 'text-mint', mock: 'text-amber', off: 'text-coral' };

interface Props {
  themeChoice: ThemeChoice;
  theme: ThemeId;
  onTheme: (c: ThemeChoice) => void;
}

export function TopBar({ themeChoice, theme, onTheme }: Props) {
  const state = useCafe();
  const now = useNow(1000);
  const all = Object.values(state.tasks);
  const working = all.filter((t) => t.status === 'running' || t.status === 'tool_wait').length;
  const queued = all.filter((t) => t.status === 'queued').length;
  const needYou = needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec).length;
  const conn = state.connection;

  return (
    <header className="flex h-14 items-center gap-5 border-b border-slate-line bg-night-2 px-4">
      <div className="flex items-baseline gap-2.5">
        <h1 className="font-display text-[30px] leading-none">Agent Café</h1>
        {conn !== 'open' && (
          <span className={`text-[11px] ${conn === 'connecting' ? 'text-amber' : 'text-coral'}`}>{conn === 'connecting' ? 'Connecting…' : 'Server offline'}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5" aria-label="Café status">
        <Pill tone="var(--color-mint)">{working} working</Pill>
        <Pill tone={needYou ? 'var(--color-coral)' : undefined}>{needYou} need you</Pill>
        {queued > 0 && <Pill>{queued} queued</Pill>}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <FloorChip id="anthropic" />
        <FloorChip id="openai" />
        <ThemePicker choice={themeChoice} theme={theme} onChange={onTheme} />
      </div>
    </header>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: string }) {
  return (
    <span className={`flex h-7 items-center gap-1.5 rounded-full bg-slate px-2.5 text-[12px] ${tone ? 'text-chalk' : 'text-chalk-dim'}`}>
      {tone && <span aria-hidden className="size-2" style={{ background: tone }} />}
      {children}
    </span>
  );
}

const WINDOW_NAME: Record<string, string> = {
  five_hour: '5-hour limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly Opus limit',
  seven_day_sonnet: 'Weekly Sonnet limit',
};

/** One floor: its harness and mode at a glance; sign-in, usage and mode inside. */
function FloorChip({ id }: { id: ProviderId }) {
  const p = useCafe((s) => s.providers[id]);
  const settings = useCafe((s) => s.settings);
  const mode = p?.mode ?? 'mock';
  const signedOut = p && (p.connection.state === 'signed_out' || p.connection.state === 'not_installed');
  return (
    <Popover
      label={`${FLOOR_NAME[id]}: ${HARNESS[id].name}`}
      side="bottom"
      align="end"
      className="w-[300px]"
      trigger={({ open, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-[13px] ${open ? 'border-[#434a58] bg-slate' : 'border-slate-line hover:bg-slate'}`}
        >
          <span className="font-label text-[10px] text-chalk-faint">{id === 'anthropic' ? 'UPSTAIRS' : 'GROUND'}</span>
          <HarnessIcon harness={HARNESS[id].id} />
          {HARNESS[id].name}
          <span className={`font-label text-[10px] ${signedOut && mode === 'live' ? 'text-coral' : MODE_TONE[mode]}`}>{mode === 'mock' ? 'DEMO' : mode.toUpperCase()}</span>
          {signedOut && <span aria-label="Signed out" className="size-1.5 rounded-full bg-coral" />}
          <Caret />
        </button>
      )}
    >
      {() => (
        <div className="flex flex-col gap-3 p-3">
          <Connection id={id} p={p} />
          <div role="radiogroup" aria-label={`${FLOOR_NAME[id]} mode`} className="grid grid-cols-3 gap-1 rounded-lg bg-night-2 p-1">
            {MODES.map((m) => (
              <ModeButton key={m.mode} id={id} p={p} m={m} />
            ))}
          </div>
          {mode === 'mock' && (
            <label className="flex cursor-pointer items-center justify-between gap-3 text-[12px] text-chalk-dim">
              <span>
                Demo traffic
                <span className="block text-[11px] text-chalk-faint">Idle demo agents pick up sample tasks</span>
              </span>
              <input
                type="checkbox"
                checked={settings.ambient}
                onChange={(e) => void api.updateSettings({ ambient: e.target.checked })}
                className="size-4 accent-[var(--color-accent)]"
              />
            </label>
          )}
        </div>
      )}
    </Popover>
  );
}

function ModeButton({ id, p, m }: { id: ProviderId; p: ProviderStatusDTO | undefined; m: (typeof MODES)[number] }) {
  const [error, setError] = useState<string | null>(null);
  const on = p?.mode === m.mode;
  const disabled = m.mode === 'live' && p?.connection.state !== 'ready' && !on;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      disabled={disabled}
      title={disabled ? p?.connection.message ?? `Sign in to ${HARNESS[id].name} first` : error ?? m.hint}
      onClick={() => !on && api.updateProvider(id, { mode: m.mode }).catch((e: Error) => setError(e.message))}
      className={`h-8 rounded-md text-[12px] disabled:cursor-not-allowed disabled:opacity-40 ${on ? 'bg-slate-2 text-chalk shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-chalk-dim hover:text-chalk'}`}
    >
      {m.label}
    </button>
  );
}

function Connection({ id, p }: { id: ProviderId; p: ProviderStatusDTO | undefined }) {
  const [checking, setChecking] = useState(false);
  const c = p?.connection;
  const harness = HARNESS[id];
  const check = () => {
    setChecking(true);
    api.checkProvider(id).finally(() => setChecking(false));
  };
  const pct = p?.usage?.utilization != null ? Math.round(p.usage.utilization * 100) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <HarnessIcon harness={harness.id} size={16} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-chalk">{harness.name}</p>
          <p className="truncate text-[12px] text-chalk-faint">
            {!c || c.state === 'checking' || checking
              ? 'Checking…'
              : c.state === 'ready'
                ? [c.account, c.plan].filter(Boolean).join(' · ') || 'Signed in'
                : c.state === 'unsupported'
                  ? 'Coming next. Demo only for now.'
                  : c.state === 'signed_out'
                    ? 'Signed out'
                    : c.state === 'not_installed'
                      ? 'Not installed'
                      : 'Couldn’t reach it'}
          </p>
        </div>
        {c && c.state !== 'unsupported' && (
          <button type="button" onClick={check} disabled={checking} className="h-7 rounded-md border border-slate-line px-2 text-[11px] text-chalk-dim hover:bg-slate-2 hover:text-chalk disabled:opacity-50">
            Check again
          </button>
        )}
      </div>
      {(c?.state === 'signed_out' || c?.state === 'not_installed') && (
        <p className="rounded-md bg-code px-2.5 py-2 text-[12px] text-chalk-dim">
          In a terminal, run <code className="font-mono text-amber">{harness.login}</code>, then check again.
        </p>
      )}
      {c?.state === 'error' && c.message && <p className="text-[12px] text-coral">{c.message}</p>}
      {pct !== null && (
        <div title={p?.usage?.resetsAt ? `Resets ${new Date(p.usage.resetsAt).toLocaleString()}` : undefined}>
          <div className="mb-1 flex justify-between text-[11px] text-chalk-faint">
            <span>{WINDOW_NAME[p!.usage!.window ?? ''] ?? 'Plan usage'}</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-night-2">
            <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? 'var(--color-coral)' : pct >= 70 ? 'var(--color-amber)' : 'var(--color-mint)' }} />
          </div>
        </div>
      )}
    </div>
  );
}
