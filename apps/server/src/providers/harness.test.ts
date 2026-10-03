import type { HarnessState } from '@agent-cafe/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeProbe } from '../test/fakeHarness.js';
import { HarnessService, type HarnessProbe } from './harness.js';

/** A probe that reports signed-out until the user "finishes" signing in. */
function signingIn(): { probe: HarnessProbe; finish: () => void } {
  let state: HarnessState = 'signed_out';
  const probe: HarnessProbe = { ...fakeProbe('signed_out'), check: () => fakeProbe(state).check() };
  return { probe, finish: () => (state = 'ready') };
}

const until = async (ok: () => boolean, ms = 2000) => {
  const t0 = Date.now();
  while (!ok()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
afterEach(() => vi.restoreAllMocks());

describe('HarnessService', () => {
  it('expires model lists and invalidates them after a check even if the account stays ready', async () => {
    let list = [{ value: 'first', label: 'First', description: '' }];
    const read = vi.fn(async () => list);
    const h = new HarnessService({ openai: { ...fakeProbe(), models: read } });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(await h.models('openai')).toEqual(list);
    list = [{ value: 'second', label: 'Second', description: '' }];
    expect((await h.models('openai'))[0]?.value).toBe('first');
    clock.mockReturnValue(now + 60_001);
    expect(await h.models('openai')).toEqual(list);
    list = [{ value: 'third', label: 'Third', description: '' }];
    await h.check('openai');
    expect(await h.models('openai')).toEqual(list);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('does not leak an old account model request into the new account cache', async () => {
    let account = 'first';
    let release!: (models: Array<{ value: string; label: string; description: string }>) => void;
    let reads = 0;
    const h = new HarnessService({ openai: {
      ...fakeProbe(), check: async () => ({ ...await fakeProbe().check(), account }),
      models: async () => ++reads === 1 ? new Promise((r) => { release = r; }) : [{ value: 'new-account-only', label: 'New', description: '' }],
    } });
    const old = h.models('openai');
    await until(() => reads === 1);
    const rejection = expect(old).rejects.toThrow('Connection changed');
    account = 'second';
    await h.check('openai');
    expect((await h.models('openai'))[0]?.value).toBe('new-account-only');
    release([{ value: 'old-account-only', label: 'Old', description: '' }]);
    await rejection;
    expect((await h.models('openai'))[0]?.value).toBe('new-account-only');
  });

  it('refresh rechecks sign-in and never serves cached options after sign-out', async () => {
    let state: HarnessState = 'ready';
    const h = new HarnessService({ openai: { ...fakeProbe(), check: () => fakeProbe(state).check(), models: async () => [{ value: 'current', label: 'Current', description: '' }] } });
    expect(await h.models('openai')).toHaveLength(1);
    state = 'signed_out';
    expect(await h.models('openai', true)).toEqual([]);
    expect(await h.models('openai')).toEqual([]);
  });
  it('keeps checking after Connect and reports the sign-in without anyone asking', async () => {
    const { probe, finish } = signingIn();
    const opened: string[][] = [];
    const h = new HarnessService({ anthropic: probe }, async (_t, _exe, args) => void opened.push(args), { everyMs: 10, forMs: 5000 });
    const changes: string[] = [];
    h.onChange((id) => changes.push(`${id}:${h.connection(id).state}`));

    await h.connect('anthropic');
    expect(opened).toEqual([['auth', 'login']]);
    expect(h.connection('anthropic').state).toBe('signed_out');

    finish(); // the user completes sign-in in the terminal, however long it takes
    await until(() => h.connection('anthropic').state === 'ready');
    expect(changes).toEqual(['anthropic:signed_out', 'anthropic:ready']);
    h.close();
  });

  it('does not open a sign-in when the CLI is already signed in', async () => {
    const opened: string[][] = [];
    const h = new HarnessService({ anthropic: fakeProbe('ready') }, async (_t, _exe, args) => void opened.push(args), { everyMs: 10, forMs: 5000 });
    const c = await h.connect('anthropic');
    expect(c.state).toBe('ready');
    expect(opened).toEqual([]);
    h.close();
  });

  it('refreshes plan usage on each check when the harness can report it', async () => {
    let used = 0.1;
    const probe: HarnessProbe = { ...fakeProbe('ready'), usage: async () => ({ status: 'allowed', window: 'five_hour', utilization: used, resetsAt: null }) };
    const h = new HarnessService({ openai: probe }, async () => {});
    await h.check('openai');
    expect(h.planUsage('openai')).toMatchObject({ utilization: 0.1 });
    used = 0.5;
    await h.check('openai');
    expect(h.planUsage('openai')).toMatchObject({ utilization: 0.5 });
    // A failing usage read never breaks the connection check.
    const flaky = new HarnessService({ openai: { ...fakeProbe('ready'), usage: async () => Promise.reject(new Error('boom')) } }, async () => {});
    expect((await flaky.check('openai')).state).toBe('ready');
    expect(flaky.planUsage('openai')).toBeNull();
  });

  it('refreshes usage on demand, saying whether it changed, and skips harnesses that aren’t ready', async () => {
    let used = 0.2;
    const probe: HarnessProbe = { ...fakeProbe('ready'), usage: async () => ({ status: 'allowed', window: 'five_hour', utilization: used, resetsAt: null }) };
    const h = new HarnessService({ anthropic: probe }, async () => {});
    await h.check('anthropic');
    expect(await h.refreshUsage('anthropic')).toBe(false); // same as the check just read
    used = 0.4;
    expect(await h.refreshUsage('anthropic')).toBe(true);
    expect(h.planUsage('anthropic')).toMatchObject({ utilization: 0.4 });

    const out = new HarnessService({ anthropic: { ...fakeProbe('signed_out'), usage: async () => Promise.reject(new Error('should not be asked')) } }, async () => {});
    await out.check('anthropic');
    expect(await out.refreshUsage('anthropic')).toBe(false);
  });

  it('does not open a sign-in for a CLI that is too old, and says to update', async () => {
    const opened: string[][] = [];
    const old: HarnessProbe = { ...fakeProbe('ready'), check: async () => ({ ...(await fakeProbe('ready').check()), state: 'unsupported', message: 'Run `codex update`.' }) };
    const h = new HarnessService({ openai: old }, async (_t, _e, args) => void opened.push(args));
    await expect(h.connect('openai')).rejects.toThrow(/codex update/);
    expect(opened).toEqual([]);
  });

  it('stops watching after the time limit', async () => {
    const { probe } = signingIn();
    const h = new HarnessService({ anthropic: probe }, async () => {}, { everyMs: 5, forMs: 30 });
    let checks = 0;
    h.onChange(() => checks++);
    await h.connect('anthropic');
    await new Promise((r) => setTimeout(r, 120));
    const seen = checks;
    await new Promise((r) => setTimeout(r, 60));
    expect(checks).toBe(seen); // no more checks, so no more changes possible
    h.close();
  });
});
