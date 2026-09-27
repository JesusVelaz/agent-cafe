import { describe, expect, it } from 'vitest';
import { estimateCost, findModel, modelsFor } from './catalog.js';

describe('model catalog', () => {
  it('prices a million input tokens at the per-MTok rate', () => {
    expect(estimateCost('claude-sonnet-5', 1_000_000, 0)).toBe(2);
  });

  it('prices mixed input and output', () => {
    // 2000 * 0.10/1M + 1000 * 0.50/1M = 0.0002 + 0.0005
    expect(estimateCost('gpt-6-luna', 2000, 1000)).toBeCloseTo(0.0007, 10);
  });

  it('returns null for unknown models', () => {
    expect(estimateCost('my-custom-model', 10, 10)).toBeNull();
  });

  it('groups models by provider', () => {
    expect(modelsFor('anthropic').every((m) => m.providerId === 'anthropic')).toBe(true);
    expect(modelsFor('openai').length).toBeGreaterThan(0);
    expect(findModel('claude-opus-5')?.label).toBe('Claude Opus 5');
  });
});
