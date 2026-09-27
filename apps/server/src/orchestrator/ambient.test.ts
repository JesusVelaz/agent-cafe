import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../events/bus.js';
import { ProviderConfigService } from '../providers/config.js';
import { MockAdapter } from '../providers/mock.js';
import { SettingsService } from '../settings.js';
import { testDb } from '../test/testDb.js';
import type { ToolRegistry } from '../tools/registry.js';
import { AmbientDriver } from './ambient.js';
import { Orchestrator } from './orchestrator.js';

const tools: ToolRegistry = { specs: [], execute: async () => ({ ok: true, output: 'ok' }) };

async function setup() {
  const db = await testDb({ seed: true });
  const providers = new ProviderConfigService(db, { anthropic: 'sk-ant-test-123456' }, randomBytes(32));
  const settings = new SettingsService(db);
  const mock = new MockAdapter({ sleep: async () => {}, failRate: 0 });
  const orchestrator = new Orchestrator({
    db, bus: new EventBus(), providers, settings, tools, resolveAdapter: async () => mock,
  });
  const driver = new AmbientDriver({ db, orchestrator, providers, settings, rng: () => 0 });
  return { db, providers, settings, orchestrator, driver };
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

  it('does nothing when ambient mode is off', async () => {
    const { driver, settings } = await setup();
    await settings.update({ ambient: false });
    expect(await driver.tick()).toBeNull();
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
