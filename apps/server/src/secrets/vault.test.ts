import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, loadOrCreateMasterKey, maskKey } from './vault.js';

const key = randomBytes(32);

describe('vault', () => {
  it('round-trips a secret', () => {
    expect(decryptSecret(encryptSecret('sk-test-123', key), key)).toBe('sk-test-123');
  });

  it('uses a fresh IV each time', () => {
    expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
  });

  it('rejects tampered ciphertext', () => {
    const blob = encryptSecret('sk-test-123', key);
    const [v, iv, tag, ct] = blob.split(':');
    const bytes = Buffer.from(ct!, 'base64');
    bytes[0]! ^= 0xff;
    expect(() => decryptSecret([v, iv, tag, bytes.toString('base64')].join(':'), key)).toThrow();
  });

  it('rejects the wrong key', () => {
    expect(() => decryptSecret(encryptSecret('x', key), randomBytes(32))).toThrow();
  });

  it('masks keys to a short hint', () => {
    expect(maskKey('sk-proj-abcdefghijklmnop1234')).toBe('sk-…1234');
    expect(maskKey('abc')).toBe('…');
  });

  it('creates the master key once and reuses it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cafe-home-'));
    const a = loadOrCreateMasterKey(dir);
    const b = loadOrCreateMasterKey(dir);
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(true);
  });
});
