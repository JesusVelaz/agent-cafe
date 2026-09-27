import type { ProviderId, TaskDTO, TaskStatus } from '@agent-cafe/shared';

export function usd(n: number | null | undefined, digits?: number): string {
  if (n === null || n === undefined) return '—';
  const d = digits ?? (n !== 0 && Math.abs(n) < 0.01 ? 4 : 2);
  return `$${n.toFixed(d)}`;
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

export function taskDuration(t: TaskDTO, now: number): number | null {
  if (!t.startedAt) return null;
  const end = t.finishedAt ? Date.parse(t.finishedAt) : now;
  return end - Date.parse(t.startedAt);
}

export function tokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function ago(iso: string, now: number): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const FLOOR_NAME: Record<ProviderId, string> = { openai: 'Ground floor', anthropic: 'Upstairs' };
export const PROVIDER_NAME: Record<ProviderId, string> = { openai: 'OpenAI', anthropic: 'Anthropic' };

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: 'Queued',
  running: 'Working',
  tool_wait: 'Using a tool',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

/** Status → CSS colour token (see globals.css). */
export const STATUS_TONE: Record<TaskStatus, string> = {
  queued: 'var(--color-chalk-dim)',
  running: 'var(--color-mint)',
  tool_wait: 'var(--color-amber)',
  completed: 'var(--color-mint)',
  failed: 'var(--color-coral)',
  cancelled: 'var(--color-chalk-dim)',
  interrupted: 'var(--color-coral)',
};
