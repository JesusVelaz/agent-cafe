'use client';

import { PROVIDER_IDS, type ProviderId, type ProviderMode } from '@agent-cafe/shared';
import { useState } from 'react';
import { api } from '@/lib/api';
import { PROVIDER_NAME, usd } from '@/lib/format';
import { useCafe } from '@/store/cafe';
import { StatusDot } from './Panel';

const MODES: Array<{ mode: ProviderMode; label: string }> = [
  { mode: 'live', label: 'Live' },
  { mode: 'mock', label: 'Demo' },
  { mode: 'off', label: 'Off' },
];

export function TopBar() {
  const connection = useCafe((s) => s.connection);
  const tasks = useCafe((s) => s.tasks);
  const providers = useCafe((s) => s.providers);
  const ambient = useCafe((s) => s.settings.ambient);
  const [error, setError] = useState<string | null>(null);

  const all = Object.values(tasks);
  const working = all.filter((t) => t.status === 'running' || t.status === 'tool_wait').length;
  const queued = all.filter((t) => t.status === 'queued').length;
  const midnight = new Date().setHours(0, 0, 0, 0);
  const failedToday = all.filter(
    (t) => (t.status === 'failed' || t.status === 'interrupted') && t.finishedAt && Date.parse(t.finishedAt) >= midnight,
  ).length;

  const setMode = async (id: ProviderId, mode: ProviderMode) => {
    setError(null);
    try {
      await api.updateProvider(id, { mode });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b-[3px] border-walnut-dark bg-night-2 px-4 py-2">
      <div className="flex items-baseline gap-2">
        <h1 className="font-display text-3xl leading-none tracking-wide text-chalk">
          Agent Café
        </h1>
        <span className="flex items-center gap-1.5 font-label text-[10px] uppercase text-chalk-dim">
          <StatusDot
            color={connection === 'open' ? 'var(--color-mint)' : connection === 'connecting' ? 'var(--color-amber)' : 'var(--color-coral)'}
            pulse={connection === 'connecting'}
          />
          {connection === 'open' ? 'Open' : connection === 'connecting' ? 'Connecting' : 'Server offline'}
        </span>
      </div>

      <dl className="flex items-baseline gap-5" aria-label="Café status">
        <Stat label="Working" value={working} tone="var(--color-mint)" />
        <Stat label="Queued" value={queued} tone="var(--color-chalk)" />
        <Stat label="Failed today" value={failedToday} tone={failedToday ? 'var(--color-coral)' : 'var(--color-chalk-faint)'} />
      </dl>

      <div className="ml-auto flex flex-wrap items-center gap-4">
        {PROVIDER_IDS.map((id) => {
          const p = providers[id];
          return (
            <div key={id} className="flex items-center gap-2">
              <div className="leading-tight">
                <div className="font-label text-[10px] uppercase text-chalk-dim">{PROVIDER_NAME[id]}</div>
                <div className="text-xs text-chalk" title="Live spend since midnight / daily cap">
                  {p ? `${usd(p.spentTodayUsd, 2)} / ${usd(p.dailyCapUsd, 0)}` : '—'}
                </div>
              </div>
              <div role="radiogroup" aria-label={`${PROVIDER_NAME[id]} mode`} className="flex">
                {MODES.map(({ mode, label }) => {
                  const active = p?.mode === mode;
                  const disabled = mode === 'live' && !p?.hasKey;
                  return (
                    <button
                      key={mode}
                      role="radio"
                      aria-checked={active}
                      disabled={disabled}
                      aria-label={label}
                      title={disabled ? 'Add an API key to go live' : undefined}
                      onClick={() => !active && setMode(id, mode)}
                      className={`border-2 border-walnut-dark px-2 py-0.5 font-label text-[10px] uppercase -ml-[2px] first:ml-0 transition-colors ${
                        active
                          ? mode === 'live'
                            ? 'bg-mint text-ink'
                            : mode === 'off'
                              ? 'bg-coral text-ink'
                              : 'bg-brass text-ink'
                          : 'bg-slate text-chalk-dim hover:text-chalk disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-chalk-dim'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <label className="flex cursor-pointer items-center gap-2" title="Idle demo agents pick up sample orders by themselves. Never uses live providers.">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={ambient}
            onChange={(e) => api.updateSettings({ ambient: e.target.checked }).catch((err) => setError(err.message))}
          />
          <span className="relative h-4 w-8 border-2 border-walnut-dark bg-slate peer-checked:bg-teal peer-focus-visible:outline-2 peer-focus-visible:outline-brass">
            <span className={`absolute top-0 size-3 bg-chalk transition-[left] ${ambient ? 'left-4' : 'left-0'}`} />
          </span>
          <span className="font-label text-[10px] uppercase text-chalk-dim">Demo traffic</span>
        </label>
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
      <dd className="font-display text-2xl leading-none" style={{ color: tone }}>
        {value}
      </dd>
      <dt className="font-label text-[10px] uppercase text-chalk-dim">{label}</dt>
    </div>
  );
}
