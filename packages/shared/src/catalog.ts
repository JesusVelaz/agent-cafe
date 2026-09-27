import type { ProviderId } from './domain';

export interface ModelInfo {
  id: string;
  providerId: ProviderId;
  label: string;
  /** USD per million input tokens (standard tier). */
  inputPerMTok: number;
  /** USD per million output tokens (standard tier). */
  outputPerMTok: number;
  tier: 'flagship' | 'balanced' | 'fast';
}

/**
 * Curated models with standard-tier prices. Prices change; bump CATALOG_AS_OF when
 * you re-verify. Any model id can still be typed in the UI; unknown ids simply have
 * no cost estimate (and no per-task budget enforcement).
 *
 * Sources (checked 2026-09-27):
 *  - Anthropic: Claude API reference, current models table
 *  - OpenAI: https://developers.openai.com/api/docs/pricing
 */
export const CATALOG_AS_OF = '2026-09-27';

export const MODEL_CATALOG: readonly ModelInfo[] = [
  // Anthropic
  { id: 'claude-fable-5-1', providerId: 'anthropic', label: 'Claude Fable 5.1', inputPerMTok: 10, outputPerMTok: 50, tier: 'flagship' },
  { id: 'claude-opus-5-5', providerId: 'anthropic', label: 'Claude Opus 5.5', inputPerMTok: 4, outputPerMTok: 20, tier: 'flagship' },
  { id: 'claude-opus-5', providerId: 'anthropic', label: 'Claude Opus 5', inputPerMTok: 5, outputPerMTok: 25, tier: 'flagship' },
  { id: 'claude-sonnet-5', providerId: 'anthropic', label: 'Claude Sonnet 5', inputPerMTok: 2, outputPerMTok: 10, tier: 'balanced' },
  { id: 'claude-haiku-4-5', providerId: 'anthropic', label: 'Claude Haiku 4.5', inputPerMTok: 1, outputPerMTok: 5, tier: 'fast' },
  // OpenAI
  { id: 'gpt-6-astra', providerId: 'openai', label: 'GPT-6 Astra', inputPerMTok: 10, outputPerMTok: 50, tier: 'flagship' },
  { id: 'gpt-6-sol', providerId: 'openai', label: 'GPT-6 Sol', inputPerMTok: 2, outputPerMTok: 10, tier: 'balanced' },
  { id: 'gpt-6-luna', providerId: 'openai', label: 'GPT-6 Luna', inputPerMTok: 0.1, outputPerMTok: 0.5, tier: 'fast' },
  { id: 'gpt-5.4-mini', providerId: 'openai', label: 'GPT-5.4 mini', inputPerMTok: 0.75, outputPerMTok: 4.5, tier: 'fast' },
];

export function findModel(modelId: string): ModelInfo | undefined {
  return MODEL_CATALOG.find((m) => m.id === modelId);
}

export function modelsFor(providerId: ProviderId): ModelInfo[] {
  return MODEL_CATALOG.filter((m) => m.providerId === providerId);
}

/** Estimated USD cost, or null when the model isn't in the catalog. */
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number | null {
  const m = findModel(modelId);
  if (!m) return null;
  return (inputTokens * m.inputPerMTok + outputTokens * m.outputPerMTok) / 1_000_000;
}
