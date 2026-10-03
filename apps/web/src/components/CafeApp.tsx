'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { api } from '@/lib/api';
import { connectStream } from '@/lib/stream';
import { useTheme } from '@/lib/theme';
import { readFlag, useCafe } from '@/store/cafe';
import { PanelRail, SidePanel } from './SidePanel';
import { TopBar } from './TopBar';

// The scene uses canvas APIs on mount; keep it out of the server render.
const CafeStage = dynamic(() => import('./CafeStage').then((m) => m.CafeStage), {
  ssr: false,
  loading: () => <div className="grid place-items-center bg-night text-xs text-chalk-faint">Opening the café…</div>,
});

/**
 * The café on the left, the side panel (board and agent threads) on the right.
 * Folding the panel into its rail gives the café view: the café fills the screen,
 * with callouts for agents that need you and a message bar. The switch animates.
 */
export function CafeApp() {
  useEffect(() => {
    const { apply, setConnection } = useCafe.getState();
    return connectStream(apply, setConnection);
  }, []);
  useEffect(() => useCafe.setState({ panelCollapsed: readFlag('cafe.panelCollapsed') }), []);
  // Coming back to the window (say, after signing in elsewhere): re-check any provider that isn't connected.
  useEffect(() => {
    const recheck = () => {
      if (document.visibilityState !== 'visible') return;
      for (const p of Object.values(useCafe.getState().providers)) {
        if (p && p.connection.state !== 'ready' && p.connection.state !== 'checking') void api.checkProvider(p.id).catch(() => {});
      }
    };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', recheck);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', recheck);
    };
  }, []);

  const { choice, theme, setChoice } = useTheme();
  const hydrated = useCafe((s) => s.hydrated);
  const connection = useCafe((s) => s.connection);
  const collapsed = useCafe((s) => s.panelCollapsed);

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] overflow-x-hidden bg-night text-chalk lg:overflow-hidden">
      <TopBar themeChoice={choice} theme={theme} onTheme={setChoice} />
      <div className="relative grid min-h-0">
        <main
          className={`grid min-h-0 grid-rows-[minmax(360px,1fr)_auto] lg:grid-rows-1 lg:transition-[grid-template-columns] lg:duration-300 lg:ease-[cubic-bezier(.2,.8,.2,1)] ${
            collapsed ? 'lg:grid-cols-[minmax(0,1fr)_56px]' : 'lg:grid-cols-[minmax(0,1fr)_520px]'
          }`}
        >
          <CafeStage theme={theme} collapsed={collapsed} />
          {/* Both panel faces stay mounted; the column slides and they cross-fade.
              Clip, not hidden: a hidden box can still be scrolled, and the thread's
              scrollIntoView would slide the folded rail sideways. */}
          <div className="relative min-h-0 overflow-clip border-slate-line lg:border-l">
            <div
              inert={collapsed}
              className={`h-[70dvh] transition-[opacity,visibility] duration-200 lg:absolute lg:inset-y-0 lg:left-0 lg:h-auto lg:w-[520px] ${collapsed ? 'lg:invisible lg:opacity-0' : 'visible opacity-100 lg:delay-100'}`}
            >
              <SidePanel />
            </div>
            <div
              inert={!collapsed}
              className={`hidden transition-opacity duration-200 lg:absolute lg:inset-0 lg:block ${collapsed ? 'opacity-100 lg:delay-150' : 'pointer-events-none opacity-0'}`}
            >
              <PanelRail />
            </div>
          </div>
        </main>
        {!hydrated && connection === 'down' && <OfflineNotice />}
      </div>
    </div>
  );
}

function OfflineNotice() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-night/80 p-6">
      <div className="max-w-sm rounded-xl border border-slate-line bg-slate p-5 text-center">
        <p className="font-display text-3xl leading-none">The café is closed</p>
        <p className="mt-2 text-xs text-chalk-dim">
          The server isn’t answering on 127.0.0.1:4318. Start everything with <code className="font-mono text-accent">pnpm dev</code> from the repo root.
          This page reconnects by itself.
        </p>
      </div>
    </div>
  );
}
