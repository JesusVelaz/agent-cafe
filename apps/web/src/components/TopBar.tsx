'use client';

import { DEFAULTS } from '@agent-cafe/shared';
import { useState } from 'react';
import type { ThemeChoice } from '@/lib/theme';
import { useNow } from '@/lib/useNow';
import type { ThemeId } from '@/scene/atmosphere';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';
import { SettingsDialog } from './SettingsDialog';

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
  const [settings, setSettings] = useState(false);
  // A live floor that can't run (signed out, not installed) is worth a dot on the gear.
  const attention = Object.values(state.providers).some((p) => p && p.mode === 'live' && !p.liveAvailable && p.connection.state !== 'checking');

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
        <button
          type="button"
          onClick={() => setSettings(true)}
          aria-label={attention ? 'Settings (a provider needs attention)' : 'Settings'}
          title="Settings"
          className="relative flex h-9 items-center gap-2 rounded-lg border border-slate-line px-3 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2" />
          </svg>
          Settings
          {attention && <span aria-hidden className="absolute -right-1 -top-1 size-2.5 rounded-full bg-coral shadow-[0_0_0_2px_var(--color-night-2)]" />}
        </button>
      </div>
      <SettingsDialog open={settings} onClose={() => setSettings(false)} themeChoice={themeChoice} theme={theme} onTheme={onTheme} />
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
