import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The pairing secret, kept in the data folder so paired devices stay paired across restarts.
 * `renew` makes a new one, which signs out every device paired with the old one.
 */
export function pairingToken(dataDir: string, renew = false): { token: string; created: boolean } {
  const file = join(dataDir, 'pairing-token');
  if (!renew && existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim();
    if (/^[0-9a-f]{64}$/.test(token)) return { token, created: false };
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); // writeFileSync's mode only applies when it creates the file
  return { token, created: true };
}
