import type { ProviderId, ProviderMode } from '@agent-cafe/shared';
import type { ProviderConfigService } from './config.js';
import { MockAdapter } from './mock.js';
import { AdapterError, type ProviderAdapter } from './types.js';

export type AdapterResolver = (providerId: ProviderId, mode: ProviderMode) => Promise<ProviderAdapter>;

/**
 * Picks the adapter for a provider in a given mode. Keys are resolved here, per task,
 * so a key change in Settings takes effect on the next task without a restart.
 */
export function createAdapterResolver(
  providers: ProviderConfigService,
  mock: ProviderAdapter = new MockAdapter(),
): AdapterResolver {
  return async (providerId, mode) => {
    if (mode === 'mock') return mock;
    if (mode === 'off') throw new AdapterError(`${providerId} is switched off.`);
    const key = await providers.resolveKey(providerId);
    if (!key) throw new AdapterError(`No API key configured for ${providerId}.`);
    // Phase 2: return new OpenAIAdapter(key) / new AnthropicAdapter(key) here.
    throw new AdapterError(`Live ${providerId} calls arrive in Phase 2. Switch ${providerId} to Mock for now.`);
  };
}
