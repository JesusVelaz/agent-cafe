import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { testDb } from '../test/testDb.js';
import { ProviderConfigService } from './config.js';

const masterKey = randomBytes(32);
const KEY = 'sk-ant-secret-value-9876';

async function setup(envKeys = {}) {
  const db = await testDb({ seed: true });
  return { db, svc: new ProviderConfigService(db, envKeys, masterKey) };
}

describe('ProviderConfigService', () => {
  it('stores keys encrypted and only ever reports a hint', async () => {
    const { db, svc } = await setup();
    const status = await svc.update('anthropic', { apiKey: KEY });
    expect(status).toMatchObject({ hasKey: true, keySource: 'stored', keyHint: 'sk-…9876' });
    expect(JSON.stringify(status)).not.toContain(KEY);
    const row = await db.providerConfig.findUniqueOrThrow({ where: { id: 'anthropic' } });
    expect(row.encryptedKey).not.toContain(KEY);
    expect(await svc.resolveKey('anthropic')).toBe(KEY);
  });

  it('prefers the environment key', async () => {
    const { svc } = await setup({ anthropic: 'sk-ant-from-env-0000' });
    await svc.update('anthropic', { apiKey: KEY });
    expect(await svc.resolveKey('anthropic')).toBe('sk-ant-from-env-0000');
    expect((await svc.status('anthropic')).keySource).toBe('env');
  });

  it('refuses live mode without a key', async () => {
    const { svc } = await setup();
    await expect(svc.update('openai', { mode: 'live' })).rejects.toThrow(/key/i);
  });

  it('clears a stored key and falls back to mock', async () => {
    const { svc } = await setup();
    await svc.update('openai', { apiKey: KEY, mode: 'live' });
    const s = await svc.update('openai', { clearKey: true });
    expect(s).toMatchObject({ hasKey: false, keyHint: null, mode: 'mock' });
  });

  it('sums only live spend since midnight and closes at the cap', async () => {
    const { db, svc } = await setup();
    const agent = await db.agent.findFirstOrThrow({ where: { providerId: 'openai' } });
    const base = {
      agentId: agent.id,
      providerId: 'openai',
      model: agent.model,
      prompt: 'x',
      maxCostUsd: 1,
      status: 'completed',
    };
    const now = new Date();
    const yesterday = new Date(now.getTime() - 36 * 3600_000);
    await db.task.createMany({
      data: [
        { ...base, costUsd: 3, startedAt: now },
        { ...base, costUsd: 2.5, startedAt: now },
        { ...base, costUsd: 9, startedAt: now, isMock: true },
        { ...base, costUsd: 9, startedAt: yesterday },
      ],
    });
    const s = await svc.status('openai');
    expect(s.spentTodayUsd).toBeCloseTo(5.5);
    expect(s.closed).toBe(true);
  });
});
