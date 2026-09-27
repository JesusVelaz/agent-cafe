'use client';

import { DEFAULTS, PROVIDER_IDS, type ProviderId, type ProviderMode } from '@agent-cafe/shared';
import { useState } from 'react';
import type { ThemeChoice } from '@/lib/theme';
import { api } from '@/lib/api';
import { PROVIDER_NAME, usd } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import type { ThemeId } from '@/scene/atmosphere';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';
import { StatusDot } from './Panel';
import { ThemePicker } from './ThemePicker';

const MODES: Array<{ mode: ProviderMode; label: string }> = [
  { mode: 'live', label: 'Live' },
  { mode: 'mock', label: 'Demo' },
  { mode: 'off', label: 'Off' },
];

interface Props {
  themeChoice: ThemeChoice;
  theme: ThemeId;
  onTheme: (c: ThemeChoice) => void;
}

export function TopBar({ themeChoice, theme, onTheme }: Props) {
  const state = useCafe();
  const now = useNow(1000);
  const [error, setError] = useState<string | null>(null);
  const all = Object.values(state.tasks);
  const working = all.filter((t) => t.status === 'running' || t.status === 'tool_wait').length;
  const queued = all.filter((t) => t.status === 'queued').length;
  const needYou = needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec).length;

  const setMode = (id: ProviderId, mode: ProviderMode) => {
    setError(null);
    api.updateProvider(id, { mode }).catch((e: Error) => setError(e.message));
  };

  return (
    <header className="flex flex-wrap items-center gap-x-7 gap-y-2 border-b-[3px] border-slate-line bg-night-2 px-5 py-2">
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-[34px] leading-none">Agent Café</h1>
        <span className="flex items-center gap-1.5 font-label text-[10px] text-chalk-dim">
          <StatusDot
            color={state.connection === 'open' ? 'var(--color-mint)' : state.connection === 'connecting' ? 'var(--color-amber)' : 'var(--color-coral)'}
            pulse={state.connection === 'connecting'}
          />
          {state.connection === 'open' ? 'OPEN' : state.connection === 'connecting' ? 'CONNECTING' : 'SERVER OFFLINE'}
        </span>
      </div>

      <dl className="flex items-baseline gap-5" aria-label="Café status">
        <Stat label="WORKING" value={working} tone="var(--color-mint)" />
        <Stat label="NEED YOU" value={needYou} tone={needYou ? 'var(--color-coral)' : 'var(--color-chalk-faint)'} />
        <Stat label="QUEUED" value={queued} tone="var(--color-chalk)" />
      </dl>

      <div className="ml-auto flex flex-wrap items-center gap-5">
        {PROVIDER_IDS.map((id) => {
          const p = state.providers[id];
          const pct = p ? Math.min(100, (p.spentTodayUsd / Math.max(p.dailyCapUsd, 0.01)) * 100) : 0;
          return (
            <div key={id} className="flex items-center gap-2.5">
              <div className="w-32">
                <div className="flex justify-between font-label text-[10px] text-chalk-dim">
                  <span>{PROVIDER_NAME[id].toUpperCase()}</span>
                  <span className={p?.closed ? 'text-coral' : ''}>{p?.closed ? 'CLOSED' : ''}</span>
                </div>
                <div className="mt-1 h-1.5 bg-slate-2" title="Live spend today against the daily cap">
                  <div className="h-1.5" style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--color-coral)' : 'var(--color-mint)' }} />
                </div>
                <div className="mt-0.5 text-[11px] text-chalk-dim">{p ? `${usd(p.spentTodayUsd, 2)} of ${usd(p.dailyCapUsd, 2)} today` : '—'}</div>
              </div>
              <div role="radiogroup" aria-label={`${PROVIDER_NAME[id]} mode`} className="flex">
                {MODES.map(({ mode, label }) => {
                  const on = p?.mode === mode;
                  const disabled = mode === 'live' && !p?.hasKey;
                  return (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={label}
                      disabled={disabled}
                      title={disabled ? 'Add an API key to go live' : undefined}
                      onClick={() => !on && setMode(id, mode)}
                      className={`-ml-[2px] h-8 border-2 border-slate-line px-2 font-label text-[10px] first:ml-0 ${
                        on
                          ? mode === 'live' ? 'relative z-10 bg-mint text-night' : mode === 'off' ? 'relative z-10 bg-coral text-night' : 'relative z-10 bg-brass text-night'
                          : 'bg-slate text-chalk-dim hover:text-chalk disabled:cursor-not-allowed disabled:opacity-40'
                      }`}
                    >
                      {label.toUpperCase()}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <label className="flex cursor-pointer items-center gap-2" title="Idle demo agents pick up sample tasks by themselves. Never uses live providers.">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={state.settings.ambient}
            onChange={(e) => api.updateSettings({ ambient: e.target.checked }).catch((err: Error) => setError(err.message))}
          />
          <span className="relative h-4 w-8 border-2 border-slate-line bg-slate peer-checked:bg-teal peer-focus-visible:outline-2 peer-focus-visible:outline-brass">
            <span className={`absolute top-0 size-3 bg-chalk transition-[left] ${state.settings.ambient ? 'left-4' : 'left-0'}`} />
          </span>
          <span className="font-label text-[10px] text-chalk-dim">DEMO TRAFFIC</span>
        </label>

        <ThemePicker choice={themeChoice} theme={theme} onChange={onTheme} />

        <button
          type="button"
          aria-pressed={state.focus}
          onClick={() => state.setFocus(!state.focus)}
          className={`h-10 border-2 px-3 font-label text-[10px] ${state.focus ? 'border-brass bg-brass text-night' : 'border-slate-line bg-slate text-chalk hover:bg-slate-2'}`}
          title="Focus mode: the café fills the screen; only agents that need you get a callout"
        >
          {state.focus ? 'EXIT FOCUS' : 'FOCUS'}
        </button>
      </div>

      {error && (
        <p role="alert" className="w-full text-xs text-coral">
          {error}
        </p>
      )}
    </header>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="font-display text-[28px] leading-none" style={{ color: tone }}>
        {value}
      </dd>
      <dt className="font-label text-[10px] text-chalk-dim">{label}</dt>
    </div>
  );
}
