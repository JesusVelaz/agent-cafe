'use client';

import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { cupDataUrl, type Mood } from '@/lib/cup';
import { DEMO_SITE } from '@/lib/demo/flag';
import type { ThemeChoice } from '@/lib/theme';
import type { ThemeId } from '@/scene/atmosphere';
import { useCafe } from '@/store/cafe';
import { CafeStatusPill, useCafeCounts } from './BrewingPill';
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
  const { working, needYou } = useCafeCounts();
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

  return (
    <header className="flex h-14 min-w-0 items-center gap-2 sm:gap-6 border-b border-slate-line bg-night-2 px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {/* On the demo site the logo leads back to the home page. */}
        <LogoLink>
          <span data-cafe-logo className="flex">
            <CupIcon size={28} mood={mood} />
          </span>
          {/* The smallest phones keep just the cup and give the room to the buttons. */}
          <h1 className="sr-only whitespace-nowrap font-display text-[23px] leading-none min-[380px]:not-sr-only sm:text-[30px]">
            Agents <span className="text-crema">Café</span>
          </h1>
        </LogoLink>
        {DEMO_SITE && (
          <span
            title="An online demo: the agents run scripted tasks on sample data, and nothing is saved."
            className="flex h-[26px] shrink-0 items-center gap-2 rounded-full border border-coral/45 bg-coral/10 px-2 sm:px-2.5 text-[12px] font-semibold text-coral"
          >
            <span aria-hidden className="relative flex size-[7px]">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-coral opacity-60 [animation-duration:1.8s] motion-reduce:hidden" />
              <span className="relative inline-flex size-[7px] rounded-full bg-coral" />
            </span>
            <span className="hidden min-[400px]:inline">Demo</span>
          </span>
        )}
        {conn !== 'open' && (
          <span className={`truncate text-[11px] ${conn === 'connecting' ? 'text-amber' : 'text-coral'}`}>{conn === 'connecting' ? 'Connecting…' : 'Server offline'}</span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-3">
        {/* Phones show it over the café instead, where there's room. */}
        <div className="hidden sm:block">
          <CafeStatusPill />
        </div>
        {DEMO_SITE && <DownloadButton />}
        {/* Phones have no rail: this switches between the café and the threads. */}
        <button
          type="button"
          onClick={() => state.setPanelCollapsed(!state.panelCollapsed)}
          aria-label={state.panelCollapsed ? 'Show threads' : 'Show the café'}
          title={state.panelCollapsed ? 'Show threads' : 'Show the café'}
          className="grid size-9 shrink-0 place-items-center rounded-lg border border-slate-line text-chalk-dim hover:bg-slate hover:text-chalk lg:hidden"
        >
          {state.panelCollapsed ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden><path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /></svg>
          )}
        </button>
        <button
          type="button"
          onClick={() => setSettings('general')}
          aria-label={providerAttention ? 'Settings (a provider needs attention)' : 'Settings'}
          title="Settings"
          className="relative flex h-9 shrink-0 items-center gap-2 rounded-lg border border-slate-line px-2.5 sm:px-3 text-[13px] text-chalk-dim hover:bg-slate hover:text-chalk"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {/* Phones need the room for the other buttons. */}
          <span className="hidden sm:inline">Settings</span>
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

function LogoLink({ children }: { children: ReactNode }) {
  if (!DEMO_SITE) return <>{children}</>;
  return (
    <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-md">
      {children}
    </Link>
  );
}
