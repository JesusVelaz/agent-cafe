import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pairingToken } from './token.js';

const dir = () => mkdtempSync(join(tmpdir(), 'agent-cafe-token-'));

describe('pairingToken', () => {
  it('makes a long random secret once, then keeps it', () => {
    const d = dir();
    const first = pairingToken(d);
    expect(first).toEqual({ token: expect.stringMatching(/^[0-9a-f]{64}$/), created: true });
    expect(pairingToken(d)).toEqual({ token: first.token, created: false });
    expect(pairingToken(dir()).token).not.toBe(first.token);
  });

  it('makes a new one when asked', () => {
    const d = dir();
    const first = pairingToken(d).token;
    const renewed = pairingToken(d, true);
    expect(renewed.created).toBe(true);
    expect(renewed.token).not.toBe(first);
    expect(readFileSync(join(d, 'pairing-token'), 'utf8').trim()).toBe(renewed.token);
  });

  it('replaces a damaged file', () => {
    const d = dir();
    writeFileSync(join(d, 'pairing-token'), 'oops');
    expect(pairingToken(d).created).toBe(true);
  });

  it.skipIf(process.platform === 'win32')('is readable by this user only', () => {
    const d = dir();
    writeFileSync(join(d, 'pairing-token'), 'old', { mode: 0o644 });
    pairingToken(d, true);
    expect(statSync(join(d, 'pairing-token')).mode & 0o777).toBe(0o600);
  });
});
