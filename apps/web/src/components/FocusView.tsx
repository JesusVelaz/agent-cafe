'use client';

import { DEFAULTS } from '@agent-cafe/shared';
import { useCallback, useRef } from 'react';
import { duration } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import type { ThemeId } from '@/scene/atmosphere';
import type { AgentHit } from '@/scene/renderer';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';
import { AgentDetail } from './AgentPanel';
import { CafeScene } from './CafeScene';
import { Composer } from './Composer';

/**
 * Focus mode: the café fills the screen. Only agents that need you get a
 * callout (the rest show on hover), a command bar sits at the bottom, and the
 * selected agent opens in a drawer.
 *
 * Callouts follow their agent every frame. Positions are written straight to
 * the DOM from the render loop so the page doesn't re-render at 15 fps.
 */
export function FocusView({ theme }: { theme: ThemeId }) {
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

  // One callout per agent (their most urgent item).
  const byAgent = new Map<string, (typeof attention)[number]>();
  for (const a of attention) if (!byAgent.has(a.agentId)) byAgent.set(a.agentId, a);

  const overlay = (
    <div className="pointer-events-none absolute inset-0">
      {[...byAgent.values()].map((a) => (
        <button
          key={a.agentId}
          ref={(el) => {
            if (el) refs.current.set(a.agentId, el);
            else refs.current.delete(a.agentId);
          }}
          type="button"
          onClick={() => state.selectAgent(a.agentId, a.task.id)}
          className="pointer-events-auto absolute left-0 top-0 flex w-52 flex-col gap-0.5 border-2 border-coral bg-night-2 px-2.5 py-1.5 text-left shadow-lg"
        >
          <span className="font-display text-xl leading-none text-chalk">{state.agents[a.agentId]?.name}</span>
          <span className="text-[12px] text-coral">
            {a.kind === 'approval'
              ? `Wants to use ${a.task.pendingApproval?.tool ?? 'a tool'}`
              : a.kind === 'stuck'
                ? `No activity for ${duration(a.quietSec * 1000)}`
                : a.task.status === 'interrupted' ? 'Interrupted' : 'Failed'}
          </span>
          <span className="truncate text-[12px] text-chalk-dim">{a.task.prompt}</span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="relative grid min-h-0">
      <CafeScene theme={theme} reserveBottom={96} onFrame={onFrame} overlay={overlay} />
      <div className="absolute inset-x-0 bottom-3 mx-auto w-[min(760px,calc(100%-2rem))]">
        <Composer variant="bar" />
      </div>
      {state.selectedAgentId && (
        <aside aria-label="Agent" className="scroll-chalk absolute bottom-3 right-3 top-3 w-[380px] overflow-y-auto border-2 border-brass bg-night shadow-2xl">
          <AgentDetail agentId={state.selectedAgentId} onClose={() => state.selectAgent(null)} />
        </aside>
      )}
    </div>
  );
}
