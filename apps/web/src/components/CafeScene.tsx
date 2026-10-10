'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { THEMES, type ThemeId } from '@/scene/atmosphere';
import { fitFrame, fitScale, frameAt } from '@/scene/frame';
import { CafeRenderer, SCENE_H, SCENE_W, type AgentHit } from '@/scene/renderer';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { useCafe } from '@/store/cafe';
import { activeTaskFor, latestTaskFor } from '@/store/reduce';

/** How long the stage must hold still before the café takes a new scale, and how long it eases into it. */
const SETTLE_MS = 160;
const ZOOM_MS = 220;

interface Props {
  theme: ThemeId;
  /** Show pixel name tags over agents. */
  labels?: boolean;
  /** Extra space to keep clear at the bottom (Focus mode's command bar). */
  reserveBottom?: number;
  /** Called every frame with agent positions, as CSS px inside this component. */
  onFrame?: (hits: Array<AgentHit & { cssX: number; cssY: number }>) => void;
  /** Absolutely positioned layer over the scene, in the same px space as onFrame. */
  overlay?: ReactNode;
  /** Called once, when the first frame has been drawn at the stage's real size. */
  onReady?: () => void;
}

/**
 * The café canvas. The plot is sized to fit (SCENE_W×SCENE_H scaled up by a whole
 * number when it fits, for crisp pixels; fractionally only on small screens), and the
 * frame around it fills the whole stage at that scale, so the sky runs edge to edge.
 * While the stage resizes (the panel sliding) the café holds its scale and stays
 * centred; a new scale is eased into once the stage is still.
 */
export function CafeScene({ theme, labels = true, reserveBottom = 0, onFrame, overlay, onReady }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CafeRenderer | null>(null);
  const [view, setView] = useState({ scale: 2, w: SCENE_W, h: SCENE_H });
  /** The latest size, ahead of React (the panel animation resizes the stage every frame). */
  const viewRef = useRef(view);
  const { scale } = view;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const live = useRef({ theme, labels, scale, onFrame, onReady });
  live.current = { theme, labels, scale, onFrame, onReady };
  /** Sized to the stage yet, and has that size been drawn (onReady fired)? */
  const sizedRef = useRef(false);
  const readyRef = useRef(false);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Applied straight from the observer, before this frame paints, rather than after
    // React re-renders: the stage, the scale the callouts use and the redrawn canvas
    // all change together.
    const apply = (v: typeof view) => {
      viewRef.current = v;
      live.current.scale = v.scale;
      const stage = stageRef.current;
      if (stage) {
        stage.style.width = `${v.w * v.scale}px`;
        stage.style.height = `${v.h * v.scale}px`;
      }
      rendererRef.current?.resize(v.w, v.h);
      setView(v);
    };
    let sized = false;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (!sized) {
        sized = true;
        sizedRef.current = true;
        apply(fitFrame(width, height, reserveBottom));
        return;
      }
      // While the stage is being resized (the panel sliding, a window drag) the café
      // keeps its scale and stays put; only the sky around it grows or shrinks. A scale
      // changing every frame makes pixel art crawl.
      apply(frameAt(width, height, viewRef.current.scale));
      clearTimeout(settle);
      settle = setTimeout(() => {
        const from = viewRef.current.scale;
        const to = fitScale(width, height, reserveBottom);
        if (to === from) return;
        // Once it's still, take the scale that fits, easing into it rather than popping.
        apply(frameAt(width, height, to));
        const stage = stageRef.current;
        if (stage && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
          // Smooth sampling while it zooms (crisp pixels would shimmer at in-between scales), crisp again once it lands.
          const canvas = stage.querySelector('canvas');
          if (canvas) canvas.style.imageRendering = 'auto';
          const zoom = stage.animate([{ transform: `scale(${from / to})` }, { transform: 'scale(1)' }], { duration: ZOOM_MS, easing: 'cubic-bezier(.2,.8,.2,1)' });
          zoom.onfinish = () => canvas?.style.removeProperty('image-rendering');
        }
      }, SETTLE_MS);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      clearTimeout(settle);
    };
  }, [reserveBottom]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const r = new CafeRenderer({
      read: () => {
        const s = useCafe.getState();
        return { data: s, selectedAgentId: s.selectedAgentId, theme: live.current.theme, labels: live.current.labels, transparent: true, viewAngle: s.viewAngle };
      },
      turned: (quarter) => useCafe.getState().setViewAngle(quarter),
      pickAgent: (id) => {
        const s = useCafe.getState();
        // In the café view, clicking an agent opens the panel on them.
        const deselect = s.selectedAgentId === id && !s.panelCollapsed;
        s.selectAgent(deselect ? null : id);
        if (!deselect && s.panelCollapsed) s.setPanelCollapsed(false);
      },
      hover: (h) => {
        setHoverId(h?.id ?? null);
        const tip = tipRef.current;
        if (tip && h) tip.style.transform = `translate(${h.x * live.current.scale}px, ${(h.y - 10) * live.current.scale}px) translate(-50%, -100%)`;
      },
      frame: (hits) => {
        if (sizedRef.current && !readyRef.current) {
          readyRef.current = true;
          live.current.onReady?.();
        }
        const cb = live.current.onFrame;
        if (cb) cb(hits.map((h) => ({ ...h, cssX: h.headX * live.current.scale, cssY: h.headY * live.current.scale })));
      },
    });
    r.mount(host);
    r.resize(viewRef.current.w, viewRef.current.h);
    rendererRef.current = r;
    return () => {
      r.destroy();
      rendererRef.current = null;
    };
  }, []);

  const [bg0, bg1] = THEMES[theme].bg;
  return (
    <div
      ref={wrapRef}
      className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden"
      style={{ background: `linear-gradient(${bg0}, ${bg1})`, paddingBottom: reserveBottom }}
    >
      <div ref={stageRef} className="relative shrink-0" style={{ width: view.w * scale, height: view.h * scale }} data-scene-stage>
        <div ref={hostRef} className="absolute inset-0" />
        <div ref={tipRef} className="pointer-events-none absolute left-0 top-0 z-10" hidden={!hoverId}>
          {hoverId && <AgentTooltip id={hoverId} />}
        </div>
        {overlay}
      </div>
      <TurnButtons />
    </div>
  );
}

/** Q / E turn the café, unless you're typing or a dialog is open. */
function useTurnKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k !== 'q' && k !== 'e') return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      if (document.querySelector('dialog[open]')) return;
      useCafe.getState().turnView(k === 'q' ? 1 : -1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Turn the café a quarter either way. Top right, where the diorama leaves sky. */
function TurnButtons() {
  useTurnKeys();
  const turnView = useCafe((s) => s.turnView);
  const button = 'flex size-8 items-center justify-center rounded-lg text-chalk-dim hover:bg-slate-2 hover:text-chalk';
  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-0.5 rounded-xl border border-slate-line bg-night-2/85 p-0.5 shadow-lg backdrop-blur">
      <button type="button" className={button} onClick={() => turnView(1)} aria-label="Turn the café left" title="Turn left (Q)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M3.5 7.5a5 5 0 1 1 1.4 4.6" />
          <path d="M3.2 3.6v4h4" />
        </svg>
      </button>
      <button type="button" className={button} onClick={() => turnView(-1)} aria-label="Turn the café right" title="Turn right (E)">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M12.5 7.5a5 5 0 1 0-1.4 4.6" />
          <path d="M12.8 3.6v4h-4" />
        </svg>
      </button>
    </div>
  );
}

function AgentTooltip({ id }: { id: string }) {
  const state = useCafe();
  const agent = state.agents[id];
  if (!agent) return null;
  const active = activeTaskFor(state, id);
  const activity = deriveActivity({
    activeTask: active,
    latestTask: latestTaskFor(state, id),
    lastEvent: active ? state.lastEvent[active.id] : undefined,
    lastActivityAt: active ? state.lastActivityAt[active.id] : undefined,
    now: Date.now(),
  });
  return (
    <div className="max-w-64 rounded-lg border border-slate-line bg-night-2 px-2.5 py-1.5 text-[11px] leading-snug text-chalk shadow-lg">
      <div className="font-display text-lg leading-none">{agent.name}</div>
      <div className="text-chalk-faint">{agent.model}</div>
      <div>{activityLabel(activity)}</div>
      {active && <div className="truncate text-chalk-dim">“{active.prompt}”</div>}
    </div>
  );
}
