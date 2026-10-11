'use client';

import { DEFAULTS } from '@agent-cafe/shared';
import { useEffect, useState } from 'react';
import { cupDataUrl, type Mood } from '@/lib/cup';
import { DEMO_SITE } from '@/lib/demo/flag';
import type { ThemeChoice } from '@/lib/theme';
import { useNow } from '@/lib/useNow';
import type { ThemeId } from '@/scene/atmosphere';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';
import { BrewingPill } from './BrewingPill';
import { ConnectPrompt } from './ConnectPrompt';
import { CupIcon } from './CupIcon';
import { DownloadButton } from './DownloadButton';
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
  // The logo's face is the café's mood.
  const mood: Mood = needYou ? 'alert' : working ? 'working' : 'quiet';
  const conn = state.connection;
  const [settings, setSettings] = useState<Section | null>(null);
  // A live floor that can't run (signed out, not installed) is worth a dot on the gear.
  const providerAttention = Object.values(state.providers).some((p) => p && p.mode === 'live' && !p.liveAvailable && p.connection.state !== 'checking');

  // The tab tells you what's happening from another tab: title and favicon.
  useEffect(() => {
    document.title = needYou ? `(${needYou}) Agents Café` : working ? `${working} working · Agents Café` : 'Agents Café';
    const href = cupDataUrl(mood);
    for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')) link.href = href;
  }, [working, needYou, mood]);

  const showNeeds = () => {
    state.setPanelCollapsed(false);
    state.selectAgent(null);
    requestAnimationFrame(() => document.getElementById('b-need')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <header className="flex h-14 items-center gap-3 sm:gap-6 border-b border-slate-line bg-night-2 px-4">
      <div className="flex items-center gap-2.5">
        <span data-cafe-logo className="flex">
          <CupIcon size={28} mood={mood} />
        </span>
        <h1 className="whitespace-nowrap font-display text-[26px] leading-none sm:text-[30px]">
          Agent <span className="text-crema">Café</span>
        </h1>
        {DEMO_SITE && (
          <span
            title="An online demo: the agents run scripted tasks on sample data, and nothing is saved."
            className="flex h-[26px] items-center gap-2 rounded-full border border-coral/45 bg-coral/10 px-2 sm:px-2.5 text-[12px] font-semibold text-coral"
          >
            <span aria-hidden className="relative flex size-[7px]">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-coral opacity-60 [animation-duration:1.8s] motion-reduce:hidden" />
              <span className="relative inline-flex size-[7px] rounded-full bg-coral" />
            </span>
            Demo
          </span>
        )}
        {conn !== 'open' && (
          <span className={`text-[11px] ${conn === 'connecting' ? 'text-amber' : 'text-coral'}`}>{conn === 'connecting' ? 'Connecting…' : 'Server offline'}</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <BrewingPill working={working} queued={queued} needYou={needYou} onNeeds={showNeeds} />
        {DEMO_SITE && <DownloadButton />}
        <button
          type="button"
          onClick={() => setSettings('general')}
          aria-label={providerAttention ? 'Settings (a provider needs attention)' : 'Settings'}
          title="Settings"
          className="relative flex h-9 items-center gap-2 rounded-lg border border-slate-line px-3 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="8" cy="8" r="2.2" />
            <path d="M8 1.5v1.7M8 12.8v1.7M1.5 8h1.7M12.8 8h1.7M3.4 3.4l1.2 1.2M11.4 11.4l1.2 1.2M3.4 12.6l1.2-1.2M11.4 4.6l1.2-1.2" />
          </svg>
          {/* The demo's install button needs the room on phones. */}
          <span className={DEMO_SITE ? 'hidden sm:inline' : undefined}>Settings</span>
          {providerAttention && <span aria-hidden className="absolute -right-1 -top-1 size-2.5 rounded-full bg-coral shadow-[0_0_0_2px_var(--color-night-2)]" />}
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
      {!DEMO_SITE && <ConnectPrompt onConnect={() => setSettings('providers')} />}
    </header>
  );
}
