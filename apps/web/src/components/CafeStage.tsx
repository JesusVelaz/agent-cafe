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

/**
 * The café, plus what it needs when the side panel is folded away (café view):
 * a callout over each agent that needs you, fading in and out with the panel. (The
 * composer floats bottom-right by the rail then; the diorama is a diamond, so that
 * corner is empty backdrop. CafeApp places it.)
 *
 * Callouts follow their agent every frame. Positions are written straight to the
 * DOM from the render loop so the page doesn't re-render at 15 fps.
 */
export function CafeStage({ theme, collapsed, onReady }: { theme: ThemeId; collapsed: boolean; onReady?: () => void }) {
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
        <div
          key={a.agentId}
          ref={(el) => {
            if (el) refs.current.set(a.agentId, el);
            else refs.current.delete(a.agentId);
          }}
          className={`absolute left-0 top-0 w-52 rounded-lg border bg-night-2/95 shadow-lg ${collapsed ? 'pointer-events-auto' : ''} ${
            a.kind === 'approval' ? 'border-amber' : 'border-coral'
          }`}
        >
          <button type="button" onClick={() => open(a.agentId, a.task.id)} className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-1.5 pr-7 text-left">
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
          {/* A failure can be put away; an approval or a stuck run still needs you. */}
          {a.kind === 'failed' && (
            <button
              type="button"
              aria-label={`Dismiss ${state.agents[a.agentId]?.name ?? 'this'} failure`}
              title="Dismiss"
              onClick={() => state.dismiss(a.task.id)}
              className="absolute right-0.5 top-0.5 grid size-7 place-items-center rounded-md text-chalk-faint hover:bg-slate hover:text-chalk"
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden><path d="M2 2l6 6M8 2L2 8" /></svg>
            </button>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="relative grid min-h-0">
      <CafeScene theme={theme} onFrame={onFrame} overlay={overlay} onReady={onReady} />
    </div>
  );
}
