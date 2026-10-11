'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { connectStream } from '@/lib/stream';
import { useTheme } from '@/lib/theme';
import { readFlag, readViewAngle, useCafe } from '@/store/cafe';
import { CafeLoader } from './CafeLoader';
import { Composer } from './Composer';
import { PanelRail, SidePanel } from './SidePanel';
import { TopBar } from './TopBar';

// The scene uses canvas APIs on mount; keep it out of the server render. The first-load
// cover sits over it until it has drawn.
const CafeStage = dynamic(() => import('./CafeStage').then((m) => m.CafeStage), {
  ssr: false,
  loading: () => <div className="bg-night" />,
});

/**
 * The café on the left, the side panel (board and agent threads) on the right; on
 * phones the panel opens over the café instead.
 * Folding the panel into its rail gives the café view: the café fills the screen,
 * with callouts for agents that need you, and the composer lifts out of the panel to
 * float by the rail. The switch animates.
 */
export function CafeApp() {
  useEffect(() => {
    const { apply, setConnection } = useCafe.getState();
    return connectStream(apply, setConnection);
  }, []);
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
  // The panel's footer slot follows the docked composer's height.
  const mainRef = useRef<HTMLElement>(null);
  const onDockedHeight = useCallback((px: number) => mainRef.current?.style.setProperty('--composer-h', `${px}px`), []);
  // The server can't know whether the panel was left folded, so its render has it
  // open (under the first-load cover). Apply the remembered state, flush styles with
  // transitions still off, then turn them on: all before paint, so a folded panel
  // doesn't slide shut, resizing the café, on every load.
  const [loaded, setLoaded] = useState(false);
  const [settled, setSettled] = useState(false);
  useLayoutEffect(() => {
    useCafe.setState({ panelCollapsed: readFlag('cafe.panelCollapsed'), viewAngle: readViewAngle() });
    setLoaded(true);
  }, []);
  useLayoutEffect(() => {
    if (!loaded) return;
    void mainRef.current?.offsetWidth;
    setSettled(true);
  }, [loaded]);
  // The first-load cover stays until the panel has settled, the café's state has
  // arrived and the scene has drawn; then it goes for good.
  const [sceneReady, setSceneReady] = useState(false);
  const onSceneReady = useCallback(() => setSceneReady(true), []);
  const [opened, setOpened] = useState(false);
  const onOpened = useCallback(() => setOpened(true), []);

  return (
    <div data-settling={settled ? undefined : ''} data-loading={opened ? undefined : ''} className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-clip bg-night text-chalk">
      <TopBar themeChoice={choice} theme={theme} onTheme={setChoice} />
      <div className="relative grid min-h-0">
        <main
          ref={mainRef}
          className={`relative grid min-h-0 lg:grid-rows-1 lg:transition-[grid-template-columns] lg:duration-300 lg:ease-[cubic-bezier(.2,.8,.2,1)] ${
            collapsed ? 'grid-rows-1 lg:grid-cols-[minmax(0,1fr)_56px]' : 'grid-rows-1 lg:grid-cols-[minmax(0,1fr)_520px]'
          }`}
        >
          <CafeStage theme={theme} collapsed={collapsed} onReady={onSceneReady} />
          {/* Both panel faces stay mounted; the column slides and they cross-fade.
              Clip, not hidden: a hidden box can still be scrolled, and the thread's
              scrollIntoView would slide the folded rail sideways. */}
          {/* On phones the open panel covers the café (which keeps its size underneath),
              so the board and threads get the whole screen. */}
          <div className={`absolute inset-0 z-20 min-h-0 overflow-clip border-slate-line lg:relative lg:inset-auto lg:z-auto lg:border-l ${collapsed ? 'hidden lg:block' : ''}`}>
            <div
              inert={collapsed}
              className={`h-full transition-[opacity,visibility] duration-200 lg:absolute lg:inset-y-0 lg:left-0 lg:h-auto lg:w-[520px] ${collapsed ? 'lg:invisible lg:opacity-0' : 'visible opacity-100'}`}
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
          <Composer onDockedHeight={onDockedHeight} />
        </main>
      </div>
      {!opened && <CafeLoader settled={settled} hydrated={hydrated} sceneReady={sceneReady} connection={connection} onDone={onOpened} />}
    </div>
  );
}
