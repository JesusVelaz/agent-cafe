'use client';

import { useCafe } from '@/store/cafe';
import { crewStates, type CrewState } from '@/store/reduce';

/** Past this many agents the row ends in "+N". */
const MAX_PIPS = 12;

const LABEL: Record<CrewState, (n: number) => string> = {
  needs: (n) => `${n} ${n === 1 ? 'needs' : 'need'} you`,
  working: (n) => `${n} working`,
  queued: (n) => `${n} queued`,
  idle: (n) => `${n} idle`,
};

function Pip({ state }: { state: CrewState }) {
  if (state === 'queued') return <span aria-hidden className="size-2 shrink-0 border border-chalk-dim" />;
  const bg = state === 'needs' ? 'bg-coral' : state === 'working' ? 'bg-mint' : 'bg-walnut-light';
  return <span aria-hidden className={`size-2 shrink-0 ${bg}`} />;
}

/**
 * The café at a glance: one square per agent (coral needs you, mint working, hollow
 * queued, grey idle), most urgent first. Hover or focus for the counts.
 */
export function AgentPips({ needYou }: { needYou: readonly string[] }) {
  const agents = useCafe((s) => s.agents);
  const tasks = useCafe((s) => s.tasks);
  const crew = crewStates({ agents, tasks }, needYou);
  if (crew.length === 0) return null;

  const counts = (['needs', 'working', 'queued', 'idle'] as const)
    .map((state) => ({ state, n: crew.filter((c) => c.state === state).length }))
    .filter((c) => c.n > 0);
  const summary = counts.map((c) => LABEL[c.state](c.n)).join(', ');
  const shown = crew.slice(0, MAX_PIPS);
  const more = crew.length - shown.length;

  return (
    <div
      role="status"
      tabIndex={0}
      aria-label={`Café status: ${summary}`}
      className="group relative flex h-9 items-center gap-1 rounded-lg border border-slate-line px-3 hover:border-walnut-light hover:bg-slate"
    >
      {shown.map((c) => (
        <Pip key={c.agentId} state={c.state} />
      ))}
      {more > 0 && <span className="ml-1 text-[11px] text-chalk-faint">+{more}</span>}
      <div
        aria-hidden
        className="invisible absolute right-0 top-[calc(100%+6px)] z-30 flex min-w-36 flex-col gap-1.5 rounded-lg border border-walnut-light bg-slate-2 px-3 py-2.5 text-[12px] text-chalk opacity-0 shadow-[0_8px_24px_rgba(0,0,0,.45)] transition-opacity group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
      >
        {counts.map((c) => (
          <div key={c.state} className={`flex items-center gap-2 whitespace-nowrap ${c.state === 'idle' ? 'text-chalk-dim' : ''}`}>
            <Pip state={c.state} />
            {LABEL[c.state](c.n)}
          </div>
        ))}
      </div>
    </div>
  );
}
