import { describe, expect, it } from 'vitest';
import { testDb } from '../test/testDb.js';
import { SEED_AGENTS, seed } from './seed.js';

describe('seed', () => {
  it('creates the crew and provider rows, idempotently', async () => {
    const db = await testDb();
    await seed(db);
    await seed(db);
    expect(await db.agent.count()).toBe(SEED_AGENTS.length);
    const providers = await db.providerConfig.findMany();
    expect(providers.map((p) => p.mode)).toEqual(['mock', 'mock']);
  });
});
