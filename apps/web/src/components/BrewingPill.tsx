import { DEFAULTS } from '@agent-cafe/shared';
import { useNow } from '@/lib/useNow';
import { useCafe } from '@/store/cafe';
import { needsAttention } from '@/store/reduce';

/** How many agents are working, waiting in line, and need you. */
export function useCafeCounts() {
  const state = useCafe();
  const now = useNow(1000);
  const all = Object.values(state.tasks);
  return {
    working: all.filter((t) => t.status === 'running' || t.status === 'tool_wait').length,
    queued: all.filter((t) => t.status === 'queued').length,
    needYou: needsAttention(state, now, state.dismissed, DEFAULTS.stuckAfterSec).length,
  };
}

/** The pill, wired up: its "needs you" half opens the board at what needs you. */
export function CafeStatusPill() {
  const { working, queued, needYou } = useCafeCounts();
  const showNeeds = () => {
    const { setPanelCollapsed, selectAgent } = useCafe.getState();
    setPanelCollapsed(false);
    selectAgent(null);
    requestAnimationFrame(() => document.getElementById('b-need')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return <BrewingPill working={working} queued={queued} needYou={needYou} onNeeds={showNeeds} />;
}

/**
 * The café's status, only while there is any: a mint half with bubbling dots and the
 * working count, and a coral half (a button to what needs you) when someone does.
 * Nothing at all when the café is quiet; the logo's face says that.
 */
export function BrewingPill({ working, queued, needYou, onNeeds }: { working: number; queued: number; needYou: number; onNeeds: () => void }) {
  if (!working && !needYou) return null;
  const needLabel = `${needYou} ${needYou === 1 ? 'needs' : 'need'} you`;
  const brewLabel = queued ? `${working} working, ${queued} queued` : `${working} working`;
  return (
    <div className="flex h-7 items-stretch text-[12px] font-semibold">
      {needYou > 0 && (
        <button
          type="button"
          onClick={onNeeds}
          aria-label={needLabel}
          title={needLabel}
          className={`flex items-center gap-1.5 border border-[#5a3128] bg-[#2a1915] px-2.5 text-[#ff9b80] hover:bg-[#3a1f1a] ${working ? 'rounded-l-full border-r-0' : 'rounded-full'}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M4 11V7a4 4 0 0 1 8 0v4l1.2 1.5H2.8L4 11z" />
            <path d="M6.5 14.2a1.6 1.6 0 0 0 3 0" />
          </svg>
          {needYou}
        </button>
      )}
      {working > 0 && (
        <div
          role="status"
          aria-label={brewLabel}
          title={brewLabel}
          className={`flex items-center gap-2 border border-[#2b4a36] bg-[#16251c] px-2.5 text-mint ${needYou ? 'rounded-r-full' : 'rounded-full'}`}
        >
          <span aria-hidden className="flex gap-[3px]">
            <span className="brew-dot size-1 bg-mint" />
            <span className="brew-dot size-1 bg-mint" />
            <span className="brew-dot size-1 bg-mint" />
          </span>
          {working}
        </div>
      )}
    </div>
  );
}
