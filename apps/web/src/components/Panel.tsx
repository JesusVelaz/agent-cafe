import type { Activity } from '@/sim/activity';
import type { ReactNode } from 'react';

/** Small-caps pixel label used for section headings across the chalkboards. */
export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`font-label text-[10px] uppercase tracking-wider text-chalk-dim ${className}`}>{children}</div>
  );
}

export function StatusDot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-2 shrink-0 ${pulse ? 'animate-pulse' : ''}`}
      style={{ background: color, boxShadow: `0 0 0 1px var(--color-ink)` }}
    />
  );
}

/** Colour per activity, shared by the board, callouts and the agent panel. */
export const ACTIVITY_TONE: Record<Activity['kind'], string> = {
  idle: 'var(--color-chalk-faint)',
  thinking: 'var(--color-mint)',
  tool: 'var(--color-amber)',
  stuck: 'var(--color-coral)',
  done: 'var(--color-mint)',
  failed: 'var(--color-coral)',
};
