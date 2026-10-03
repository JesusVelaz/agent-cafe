import { describe, expect, it } from 'vitest';
import { offeredModel } from './models';

describe('offeredModel', () => {
  const models = [{ value: 'sonnet', label: 'Sonnet', description: '', resolved: 'claude-sonnet-5-20260101' }];
  it('recognizes exact options and canonical ids resolved by an offered alias', () => {
    expect(offeredModel(models, 'sonnet')).toBe(models[0]);
    expect(offeredModel(models, 'claude-sonnet-5')).toBe(models[0]);
    expect(offeredModel(models, 'claude-sonnet-5-20260101')).toBe(models[0]);
  });
  it('never substitutes a catalog-only model with a similarly named option', () => {
    expect(offeredModel(models, 'claude-sonnet-4')).toBeUndefined();
    expect(offeredModel([], 'claude-sonnet-5')).toBeUndefined();
  });
});
