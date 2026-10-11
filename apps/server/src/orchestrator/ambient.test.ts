import { describe, expect, it } from 'vitest';
import { EventBus } from '../events/bus.js';
import { ProviderConfigService } from '../providers/config.js';
import { MockAdapter } from '../providers/mock.js';
import { testDb } from '../test/testDb.js';
import type { ToolRegistry } from '../tools/registry.js';
import { AmbientDriver } from './ambient.js';
import { fakeHarnesses } from '../test/fakeHarness.js';
import { Orchestrator } from './orchestrator.js';

const tools: ToolRegistry = { specs: [], execute: async () => ({ ok: true, output: 'ok' }) };

async function setup() {
  const db = await testDb({ seed: true });
  const providers = new ProviderConfigService(db, fakeHarnesses());
  const mock = new MockAdapter({ sleep: async () => {}, failRate: 0 });
  const orchestrator = new Orchestrator({
    db, bus: new EventBus(), providers, tools, resolveAdapter: async () => mock,
  });
  const driver = new AmbientDriver({ db, orchestrator, providers, rng: () => 0 });
  return { db, providers, orchestrator, driver };
}

describe('AmbientDriver', () => {
  it('queues a canned task for an idle mock agent', async () => {
    const { driver, db, orchestrator } = await setup();
    const id = await driver.tick();
    expect(id).not.toBeNull();
    const task = await db.task.findUniqueOrThrow({ where: { id: id! } });
    expect(task.isMock).toBe(true);
    await orchestrator.idle();
  });

  it('never picks agents on live floors', async () => {
    const { driver, providers, db, orchestrator } = await setup();
    await providers.update('openai', { mode: 'off' });
    await providers.update('anthropic', { mode: 'live' });
    expect(await driver.tick()).toBeNull();
    expect(await db.task.count()).toBe(0);
    await orchestrator.idle();
  });
});
