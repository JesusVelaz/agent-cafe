import type { HarnessModelDTO } from './domain';

/** Older preferences may store a canonical id that a currently offered alias resolves to. */
export function offeredModel(models: readonly HarnessModelDTO[], value: string): HarnessModelDTO | undefined {
  return models.find((m) => m.value === value) ?? models.find((m) =>
    m.resolved === value || m.resolved?.replace(/\[1m\]$/, '').replace(/-\d{8}$/, '') === value,
  );
}
