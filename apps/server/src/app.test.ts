import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

describe('health', () => {
  it('responds ok', async () => {
    const app = await buildApp();
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
