'use client';

import { FLOOR_ORDER } from '@/sim/layout';
import { activityLabel, deriveActivity, type Activity } from '@/sim/activity';
import { FLOOR_NAME, PROVIDER_NAME } from '@/lib/format';
import { useNow } from '@/lib/useNow';
import { useCafe } from '@/store/cafe';
import { activeTaskFor, latestTaskFor, queuedFor } from '@/store/reduce';
import { Avatar } from './Avatar';
import { Label, StatusDot } from './Panel';

export const ACTIVITY_TONE: Record<Activity['kind'], string> = {
  idle: 'var(--color-chalk-faint)',
  thinking: 'var(--color-mint)',
  tool: 'var(--color-amber)',
  stuck: 'var(--color-coral)',
  done: 'var(--color-mint)',
  failed: 'var(--color-coral)',
};

/** Left rail: everyone on shift, grouped by floor (top floor first, like the scene). */
export function CrewRoster() {
  const state = useCafe();
  const now = useNow(1000);
  const agents = Object.values(state.agents).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <nav aria-label="Crew" className="chalkboard scroll-chalk flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 lg:border-r-[3px] lg:border-walnut-dark">
      {[...FLOOR_ORDER].reverse().map((floor) => {
        const crew = agents.filter((a) => a.providerId === floor);
        const mode = state.providers[floor]?.mode;
        return (
          <section key={floor} aria-labelledby={`floor-${floor}`}>
            <Label className="mb-2 flex items-center justify-between">
              <span id={`floor-${floor}`}>
                {FLOOR_NAME[floor]} · {PROVIDER_NAME[floor]}
              </span>
              {mode && mode !== 'live' && <span className={mode === 'off' ? 'text-coral' : 'text-brass'}>{mode === 'mock' ? 'Demo' : 'Off'}</span>}
            </Label>
            <ul className="flex flex-col gap-1">
              {crew.map((agent) => {
                const active = activeTaskFor(state, agent.id);
                const latest = latestTaskFor(state, agent.id);
                const activity = deriveActivity({
                  activeTask: active,
                  latestTask: latest,
                  lastEvent: active ? state.lastEvent[active.id] : undefined,
                  lastActivityAt: active ? state.lastActivityAt[active.id] : undefined,
                  now,
                });
                const queued = queuedFor(state, agent.id).length;
                const selected = state.selectedAgentId === agent.id;
                const demo = (active ?? latest)?.isMock ?? mode === 'mock';
                return (
                  <li key={agent.id}>
                    <button
                      onClick={() => state.selectAgent(selected ? null : agent.id)}
                      aria-pressed={selected}
                      className={`group flex w-full items-center gap-2.5 border-2 px-2 py-1.5 text-left transition-colors ${
                        selected ? 'border-brass bg-slate-2' : 'border-transparent hover:bg-slate-2'
                      }`}
                    >
                      <Avatar seed={agent.spriteSeed} demo={demo} scale={2} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="font-display text-xl leading-none text-chalk">{agent.name}</span>
                          {queued > 0 && (
                            <span className="font-label text-[10px] text-chalk-dim" title={`${queued} queued`}>
                              +{queued}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-[11px] text-chalk-faint">{agent.model}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px]" style={{ color: ACTIVITY_TONE[activity.kind] }}>
                          <StatusDot color={ACTIVITY_TONE[activity.kind]} pulse={activity.kind === 'thinking'} />
                          <span className="truncate">{activityLabel(activity)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {crew.length === 0 && <li className="px-2 text-xs text-chalk-faint">Nobody on this floor yet.</li>}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}
