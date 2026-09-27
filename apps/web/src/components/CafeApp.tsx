'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { connectStream } from '@/lib/stream';
import { useCafe } from '@/store/cafe';
import { CrewRoster } from './CrewRoster';
import { Inspector } from './Inspector';
import { OrderPad } from './OrderPad';
import { TopBar } from './TopBar';

// Pixi touches `window` on import; keep it out of the server render.
const CafeCanvas = dynamic(() => import('./CafeCanvas').then((m) => m.CafeCanvas), {
  ssr: false,
  loading: () => <div className="scene-backdrop grid place-items-center text-xs text-chalk-faint">Opening the café…</div>,
});

export function CafeApp() {
  useEffect(() => {
    const { apply, setConnection } = useCafe.getState();
    return connectStream(apply, setConnection);
  }, []);

  const hydrated = useCafe((s) => s.hydrated);
  const connection = useCafe((s) => s.connection);

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-night">
      <TopBar />
      <main className="grid min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[250px_minmax(0,1fr)_auto] lg:grid-rows-1">
        <div className="order-2 max-h-56 min-h-0 lg:order-none lg:max-h-none">
          <CrewRoster />
        </div>
        <div className="relative order-1 grid min-h-0 lg:order-none">
          <CafeCanvas />
          {!hydrated && connection === 'down' && <OfflineNotice />}
        </div>
        <div className="hidden min-h-0 lg:grid">
          <Inspector />
        </div>
      </main>
      <MobileInspector />
      <OrderPad />
    </div>
  );
}

/** Below lg the inspector slides up as a sheet when an agent is selected. */
function MobileInspector() {
  const selected = useCafe((s) => s.selectedAgentId);
  if (!selected) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 grid max-h-[70dvh] border-t-[3px] border-walnut-dark lg:hidden">
      <Inspector />
    </div>
  );
}

function OfflineNotice() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-night/80 p-6">
      <div className="pixel-frame chalkboard max-w-sm p-5 text-center">
        <p className="font-display text-3xl leading-none">The café is closed</p>
        <p className="mt-2 text-xs text-chalk-dim">
          The server isn’t answering on 127.0.0.1:4318. Start everything with <code className="text-brass">pnpm dev</code>{' '}
          from the repo root. This page reconnects by itself.
        </p>
      </div>
    </div>
  );
}
