/**
 * Encryption at rest for API keys entered through the UI.
 *
 * AES-256-GCM with a random 96-bit IV per secret; the auth tag makes tampering
 * detectable. The 32-byte master key lives outside the repo (~/.agent-cafe by
 * default), so a leaked/copied cafe.db alone does not reveal keys. This protects
 * the database file, not a fully compromised machine. OS keychain support is a
 * possible future upgrade behind this same interface.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = 'v1';

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
}

export function decryptSecret(blob: string, key: Buffer): string {
  const [version, iv, tag, ct] = blob.split(':');
  if (version !== VERSION || !iv || !tag || !ct) throw new Error('Unrecognised secret format');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

/** `sk-proj-…1234` style hint: provider-style prefix (up to the first dash) + last 4. */
export function maskKey(key: string): string {
  if (key.length < 12) return '…';
  const dash = key.indexOf('-');
  const prefix = dash > 0 && dash <= 4 ? key.slice(0, dash + 1) : '';
  return `${prefix}…${key.slice(-4)}`;
}

export function loadOrCreateMasterKey(homeDir: string): Buffer {
  const file = join(homeDir, 'master.key');
  if (existsSync(file)) {
    const key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
    if (key.length !== 32) throw new Error(`Invalid master key at ${file}`);
    return key;
  }
  mkdirSync(homeDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, key.toString('base64'), { mode: 0o600 });
  try {
    chmodSync(file, 0o600); // no-op on Windows, where the user profile ACL applies
  } catch {
    /* best effort */
  }
  return key;
}
