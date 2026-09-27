'use client';

import { useEffect, useRef, useState } from 'react';
import { activityLabel, deriveActivity } from '@/sim/activity';
import { STATUS_LABEL, usd } from '@/lib/format';
import { CafeRenderer, SCENE_H, SCENE_W, type HoverTarget } from '@/scene/renderer';
import { useCafe } from '@/store/cafe';
import { activeTaskFor, latestTaskFor } from '@/store/reduce';

/**
 * Hosts the Pixi scene. The canvas renders at SCENE_W×SCENE_H and is scaled up by
 * a whole number when it fits (crisp pixels), fractionally only on small screens.
 */
export function CafeCanvas() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(2);
  const [zoom, setZoom] = useState(0);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const scaleRef = useRef(2);

  const scale = Math.max(1, fit + zoom);
  scaleRef.current = scale;

  // Fit to the available space.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      const f = Math.min((width - 16) / SCENE_W, (height - 16) / SCENE_H);
      setFit(f >= 2 ? Math.floor(f) : Math.max(1, Math.round(f * 4) / 4));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Mount the renderer once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new CafeRenderer({
      read: () => {
        const s = useCafe.getState();
        return { data: s, selectedAgentId: s.selectedAgentId };
      },
      pickAgent: (id) => {
        const s = useCafe.getState();
        s.selectAgent(s.selectedAgentId === id ? null : id);
      },
      pickTask: (taskId, agentId) => useCafe.getState().selectAgent(agentId, taskId),
      hover: setHover,
      hoverAt: (x, y) => {
        const tip = tipRef.current;
        if (tip) tip.style.transform = `translate(${x * scaleRef.current}px, ${y * scaleRef.current}px) translate(-50%, -100%)`;
      },
    });
    void renderer.mount(host);
    return () => renderer.destroy();
  }, []);

  return (
    <div ref={wrapRef} className="scene-backdrop relative flex min-h-[320px] min-w-0 items-center justify-center overflow-auto">
      <div className="relative" style={{ width: SCENE_W * scale, height: SCENE_H * scale }}>
        <div ref={hostRef} className="absolute inset-0" />
        <div ref={tipRef} className="pointer-events-none absolute left-0 top-0 z-10" hidden={!hover}>
          {hover && <Tooltip target={hover} />}
        </div>
      </div>
      <div className="absolute bottom-3 right-3 flex flex-col gap-1" role="group" aria-label="Zoom">
        <ZoomButton label="Zoom in" onClick={() => setZoom((z) => Math.min(z + 1, 3))}>+</ZoomButton>
        <ZoomButton label="Zoom out" onClick={() => setZoom((z) => Math.max(z - 1, 1 - fit))}>−</ZoomButton>
        {zoom !== 0 && (
          <ZoomButton label="Fit to screen" onClick={() => setZoom(0)}>
            <span className="font-label text-[9px]">FIT</span>
          </ZoomButton>
        )}
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-8 place-items-center border-2 border-walnut-dark bg-slate font-display text-xl text-chalk hover:bg-slate-2"
    >
      {children}
    </button>
  );
}

function Tooltip({ target }: { target: HoverTarget }) {
  const state = useCafe();
  let title = '';
  let lines: string[] = [];
  if (target.kind === 'agent') {
    const agent = state.agents[target.id];
    if (!agent) return null;
    const active = activeTaskFor(state, agent.id);
    const activity = deriveActivity({
      activeTask: active,
      latestTask: latestTaskFor(state, agent.id),
      lastEvent: active ? state.lastEvent[active.id] : undefined,
      lastActivityAt: active ? state.lastActivityAt[active.id] : undefined,
      now: Date.now(),
    });
    title = agent.name;
    lines = [agent.model, activityLabel(activity)];
    if (active) lines.push(`“${active.prompt.slice(0, 48)}${active.prompt.length > 48 ? '…' : ''}”`);
  } else {
    const task = state.tasks[target.id];
    if (!task) return null;
    const who = state.agents[task.agentId]?.name ?? 'Unknown';
    title = target.source === 'ticket' ? `Order for ${who}` : `${who}: ${STATUS_LABEL[task.status]}`;
    lines = [`“${task.prompt.slice(0, 60)}${task.prompt.length > 60 ? '…' : ''}”`];
    if (target.source === 'cup') lines.push(`${usd(task.costUsd)}${task.isMock ? ' (demo)' : ''} · click to read`);
  }
  return (
    <div className="pixel-frame chalkboard max-w-60 px-2.5 py-1.5 text-[11px] leading-snug text-chalk shadow-lg">
      <div className="font-display text-lg leading-none">{title}</div>
      {lines.map((l, i) => (
        <div key={i} className={i === 0 ? 'text-chalk-dim' : ''}>
          {l}
        </div>
      ))}
    </div>
  );
}
