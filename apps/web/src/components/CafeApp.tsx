'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { connectStream } from '@/lib/stream';
import { useTheme } from '@/lib/theme';
import { useCafe } from '@/store/cafe';
import { TopBar } from './TopBar';
import { WorkBoard } from './WorkBoard';

// The scene uses canvas APIs on mount; keep it out of the server render.
const CafeScene = dynamic(() => import('./CafeScene').then((m) => m.CafeScene), {
  ssr: false,
  loading: () => <div className="grid place-items-center bg-night text-xs text-chalk-faint">Opening the café…</div>,
});
const FocusView = dynamic(() => import('./FocusView').then((m) => m.FocusView), { ssr: false });

/**
 * Default: café on the left, work board on the right.
 * Focus mode: the café fills the screen with callouts, a command bar and a drawer.
 */
export function CafeApp() {
  useEffect(() => {
    const { apply, setConnection } = useCafe.getState();
    return connectStream(apply, setConnection);
  }, []);

  const { choice, theme, setChoice } = useTheme();
  const focus = useCafe((s) => s.focus);
  const hydrated = useCafe((s) => s.hydrated);
  const connection = useCafe((s) => s.connection);

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-night text-chalk">
      <TopBar themeChoice={choice} theme={theme} onTheme={setChoice} />
      <div className="relative grid min-h-0">
        {focus ? (
          <FocusView theme={theme} />
        ) : (
          <main className="grid min-h-0 grid-rows-[minmax(360px,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_540px] lg:grid-rows-1">
            <CafeScene theme={theme} />
            <div className="min-h-0 border-slate-line lg:border-l-[3px]">
              <WorkBoard />
            </div>
          </main>
        )}
        {!hydrated && connection === 'down' && <OfflineNotice />}
      </div>
    </div>
  );
}

function OfflineNotice() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-night/80 p-6">
      <div className="max-w-sm border-2 border-slate-line bg-slate p-5 text-center">
        <p className="font-display text-3xl leading-none">The café is closed</p>
        <p className="mt-2 text-xs text-chalk-dim">
          The server isn’t answering on 127.0.0.1:4318. Start everything with <code className="text-brass">pnpm dev</code> from the repo root.
          This page reconnects by itself.
        </p>
      </div>
    </div>
  );
}
