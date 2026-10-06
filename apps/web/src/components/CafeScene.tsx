'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { THEMES, type ThemeId } from '@/scene/atmosphere';
import { CafeRenderer, SCENE_H, SCENE_W, type AgentHit } from '@/scene/renderer';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { useCafe } from '@/store/cafe';
import { activeTaskFor, latestTaskFor } from '@/store/reduce';

/** The biggest frame worth drawing (only a tiny scale on a huge stage gets near it). */
const MAX_FRAME = { w: 2560, h: 1600 };

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
}

/**
 * The café canvas. The plot is sized to fit (SCENE_W×SCENE_H scaled up by a whole
 * number when it fits, for crisp pixels; fractionally only on small screens), and the
 * frame around it fills the whole stage at that scale, so the sky runs edge to edge.
 */
export function CafeScene({ theme, labels = true, reserveBottom = 0, onFrame, overlay }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<CafeRenderer | null>(null);
  const [view, setView] = useState({ scale: 2, w: SCENE_W, h: SCENE_H });
  const { scale } = view;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const live = useRef({ theme, labels, scale, onFrame });
  live.current = { theme, labels, scale, onFrame };

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      const f = Math.min((width - 16) / SCENE_W, (height - 16 - reserveBottom) / SCENE_H);
      const s = f >= 2 ? Math.floor(f) : Math.max(0.25, f);
      const fit = (px: number, base: number, max: number) => Math.min(max, Math.max(base, Math.ceil(px / s)));
      setView({ scale: s, w: fit(width, SCENE_W, MAX_FRAME.w), h: fit(height, SCENE_H, MAX_FRAME.h) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [reserveBottom]);

  useEffect(() => {
    rendererRef.current?.resize(view.w, view.h);
  }, [view.w, view.h]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const r = new CafeRenderer({
      read: () => {
        const s = useCafe.getState();
        return { data: s, selectedAgentId: s.selectedAgentId, theme: live.current.theme, labels: live.current.labels, transparent: true };
      },
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
        const cb = live.current.onFrame;
        if (cb) cb(hits.map((h) => ({ ...h, cssX: h.headX * live.current.scale, cssY: h.headY * live.current.scale })));
      },
    });
    r.mount(host);
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
      <div className="relative shrink-0" style={{ width: view.w * scale, height: view.h * scale }} data-scene-stage>
        <div ref={hostRef} className="absolute inset-0" />
        <div ref={tipRef} className="pointer-events-none absolute left-0 top-0 z-10" hidden={!hoverId}>
          {hoverId && <AgentTooltip id={hoverId} />}
        </div>
        {overlay}
      </div>
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
