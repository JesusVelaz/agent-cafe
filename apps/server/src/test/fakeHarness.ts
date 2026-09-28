import type { HarnessState } from '@agent-cafe/shared';
import { HarnessService, type HarnessProbe } from '../providers/harness.js';

/** A Claude Code probe that reports a fixed state, without touching the real CLI. */
export function fakeProbe(state: HarnessState = 'ready'): HarnessProbe {
  return {
    check: async () => ({
      state,
      version: '9.9.9',
      account: state === 'ready' ? 'barista@example.com' : null,
      plan: state === 'ready' ? 'max' : null,
      message: state === 'ready' ? null : 'Run `claude auth login` in a terminal, then check again.',
      checkedAt: new Date().toISOString(),
      executable: state === 'not_installed' ? null : '/usr/local/bin/claude',
    }),
    models: async () => [{ value: 'sonnet', label: 'Sonnet', description: 'Balanced' }],
  };
}

export const fakeHarnesses = (state: HarnessState = 'ready') => new HarnessService({ anthropic: fakeProbe(state) });
