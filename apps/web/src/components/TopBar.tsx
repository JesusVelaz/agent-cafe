'use client';

import { DEFAULTS } from '@agent-cafe/shared';
import { useEffect, useState } from 'react';
import { cupDataUrl } from '@/lib/cup';
import type { ThemeChoice } from '@/lib/theme';
import { useNow } from '@/lib/useNow';
import type { ThemeId } from '@/scene/atmosphere';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';
import { ConnectPrompt } from './ConnectPrompt';
import { CupIcon } from './CupIcon';
import { SettingsDialog, type Section } from './SettingsDialog';

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
  const [settings, setSettings] = useState<Section | null>(null);
  // A live floor that can't run (signed out, not installed) is worth a dot on the gear.
  const attention = Object.values(state.providers).some((p) => p && p.mode === 'live' && !p.liveAvailable && p.connection.state !== 'checking');

  // The tab tells you what's happening from another tab: title and favicon.
  useEffect(() => {
    document.title = needYou ? `(${needYou}) Agent Café` : working ? `${working} working · Agent Café` : 'Agent Café';
    const href = cupDataUrl({ steam: working > 0, badge: needYou > 0 });
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) link.href = href;
  }, [working, needYou]);

  const showNeeds = () => {
    state.setPanelCollapsed(false);
    state.selectAgent(null);
    requestAnimationFrame(() => document.getElementById('b-need')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const quiet = !working && !queued && !needYou;

  return (
    <header className="flex h-14 items-center gap-6 border-b border-slate-line bg-night-2 px-4">
      <div className="flex items-center gap-2.5">
        <CupIcon size={28} steaming={working > 0} />
        <h1 className="font-display text-[30px] leading-none">Agent Café</h1>
        {conn !== 'open' && (
          <span className={`text-[11px] ${conn === 'connecting' ? 'text-amber' : 'text-coral'}`}>{conn === 'connecting' ? 'Connecting…' : 'Server offline'}</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-4">
        <div role="status" aria-label="Café status" className="flex items-center gap-4 text-[13px]">
          {quiet ? (
            <span className="text-chalk-faint">All quiet</span>
          ) : (
            <>
              {working > 0 && (
                <span className="flex items-center gap-1.5 text-chalk">
                  <span aria-hidden className="size-2 bg-mint" />
                  {working} working
                </span>
              )}
              {queued > 0 && <span className="text-chalk-faint">{queued} queued</span>}
              {needYou > 0 && (
                <button
                  type="button"
                  onClick={showNeeds}
                  className="flex h-7 items-center gap-1.5 rounded-full border border-[#5a3128] bg-[#2a1915] px-2.5 text-[12px] text-[#ff9b80] hover:bg-[#3a1f1a]"
                >
                  <span aria-hidden className="size-2 bg-coral" />
                  {needYou} {needYou === 1 ? 'needs' : 'need'} you
                </button>
              )}
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSettings('general')}
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
      <SettingsDialog
        open={settings !== null}
        initial={settings ?? 'general'}
        onClose={() => setSettings(null)}
        themeChoice={themeChoice}
        theme={theme}
        onTheme={onTheme}
      />
      <ConnectPrompt onConnect={() => setSettings('providers')} />
    </header>
  );
}
