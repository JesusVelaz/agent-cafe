import type { ProviderId, ProviderMode } from '@agent-cafe/shared';
import { MockAdapter } from './mock.js';
import { AdapterError, type ProviderAdapter } from './types.js';

export type AdapterResolver = (providerId: ProviderId, mode: ProviderMode) => Promise<ProviderAdapter>;

/**
 * Model adapters for the built-in tool loop, which now only runs demo tasks. Live
 * tasks run on the floor's harness instead (see harness.ts / claude.ts).
 */
export function createAdapterResolver(mock: ProviderAdapter = new MockAdapter()): AdapterResolver {
  return async (providerId, mode) => {
    if (mode === 'mock') return mock;
    throw new AdapterError(`${providerId} ${mode} tasks don't use the built-in loop.`);
  };
}
