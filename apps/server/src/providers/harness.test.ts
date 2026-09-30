import type { HarnessState } from '@agent-cafe/shared';
import { describe, expect, it } from 'vitest';
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

describe('HarnessService', () => {
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
