'use client';

import { DEFAULTS } from '@agent-cafe/shared';
import { useCallback, useRef } from 'react';
import { duration } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import type { ThemeId } from '@/scene/atmosphere';
import type { AgentHit } from '@/scene/renderer';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';
import { CafeScene } from './CafeScene';
import { Composer } from './Composer';

/** How far the café rises in café view: clears the message bar; the sky above has room to spare. */
const LIFT = 64;

/**
 * The café, plus what it needs when the side panel is folded away (café view):
 * a callout over each agent that needs you and a message bar at the bottom.
 * Both fade in and out with the panel, so there's one view to switch, not two modes.
 *
 * Callouts follow their agent every frame. Positions are written straight to the
 * DOM from the render loop so the page doesn't re-render at 15 fps.
 */
export function CafeStage({ theme, collapsed }: { theme: ThemeId; collapsed: boolean }) {
  const state = useCafe();
  const now = useNow(1000);
  const attention = needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec);
  const refs = useRef(new Map<string, HTMLElement>());

  const onFrame = useCallback((hits: Array<AgentHit & { cssX: number; cssY: number }>) => {
    for (const h of hits) {
      const el = refs.current.get(h.id);
      if (el) el.style.transform = `translate(${h.cssX + 18}px, ${h.cssY - 58}px)`;
    }
  }, []);

  const open = (agentId: string, taskId: string) => {
    state.selectAgent(agentId, taskId);
    state.setPanelCollapsed(false);
  };

  // One callout per agent (their most urgent item).
  const byAgent = new Map<string, (typeof attention)[number]>();
  for (const a of attention) if (!byAgent.has(a.agentId)) byAgent.set(a.agentId, a);

  const overlay = (
    <div inert={!collapsed} className={`pointer-events-none absolute inset-0 transition-opacity duration-300 ${collapsed ? 'opacity-100' : 'opacity-0'}`}>
      {[...byAgent.values()].map((a) => (
        <button
          key={a.agentId}
          ref={(el) => {
            if (el) refs.current.set(a.agentId, el);
            else refs.current.delete(a.agentId);
          }}
          type="button"
          onClick={() => open(a.agentId, a.task.id)}
          className={`absolute left-0 top-0 flex w-52 flex-col gap-0.5 rounded-lg border bg-night-2/95 px-2.5 py-1.5 text-left shadow-lg ${collapsed ? 'pointer-events-auto' : ''} ${
            a.kind === 'approval' ? 'border-amber' : 'border-coral'
          }`}
        >
          <span className="font-display text-xl leading-none text-chalk">{state.agents[a.agentId]?.name}</span>
          <span className={`text-[12px] ${a.kind === 'approval' ? 'text-amber' : 'text-coral'}`}>
            {a.kind === 'approval'
              ? `Wants to use ${a.task.pendingApproval?.tool ?? 'a tool'}`
              : a.kind === 'stuck'
                ? `No activity for ${duration(a.quietSec * 1000)}`
                : a.task.status === 'interrupted'
                  ? 'Interrupted'
                  : 'Failed'}
          </span>
          <span className="truncate text-[12px] text-chalk-dim">{a.task.prompt}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative grid min-h-0">
      <CafeScene theme={theme} onFrame={onFrame} overlay={overlay} lift={collapsed ? LIFT : 0} />
      <div
        inert={!collapsed}
        className={`absolute inset-x-0 bottom-4 mx-auto w-[min(720px,calc(100%-2rem))] transition-[opacity,transform] duration-300 ease-out ${
          collapsed ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0'
        }`}
      >
        <Composer variant="bar" />
      </div>
    </div>
  );
}
