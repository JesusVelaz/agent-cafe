import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { RemoteSetupError } from './network.js';
import { PhoneAccess } from './phone.js';

let cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  const { port } = s.address() as AddressInfo;
  await new Promise((resolve) => s.close(resolve));
  return port;
}

/**
 * A café whose "phone address" is loopback, so the test can play the phone. The café page's own
 * requests go through inject, as if from 127.0.0.1 (nothing else listens there).
 */
async function cafe({ withData = true } = {}) {
  const dataDir = withData ? mkdtempSync(join(tmpdir(), 'agent-cafe-data-')) : undefined;
  const port = await freePort();
  const webDir = mkdtempSync(join(tmpdir(), 'agent-cafe-web-'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Agent Café</title>');
  const phone = new PhoneAccess(port, dataDir, (choice) => {
    if (choice === 'nowhere') throw new RemoteSetupError('No Tailscale address on this computer.');
    return { address: '127.0.0.1', kind: 'lan' };
  });
  const app = await buildApp(undefined, { port, webDir, remote: phone.current, phone });
  phone.attach(app);
  await app.ready();
  cleanup.push(() => phone.stop(), () => app.close());
  const local = (method: 'GET' | 'POST' | 'DELETE', payload?: unknown) =>
    app.inject({ method, url: '/api/phone', headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}` }, ...(payload ? { payload } : {}) });
  return { port, dataDir, local };
}

function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingMessage['headers'] }>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers, agent: false }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers }));
    })
      .on('error', reject)
      .end();
  });
}

describe('connect your phone', () => {
  it('starts off, then opens to phones from the café page', async () => {
    const { port, dataDir, local } = await cafe();
    expect((await local('GET')).json()).toEqual({ available: true, sharing: null });
    await expect(get(port, '/')).rejects.toThrow(/ECONNREFUSED/);

    const on = (await local('POST', { via: 'lan' })).json();
    const token = readFileSync(join(dataDir!, 'pairing-token'), 'utf8').trim();
    expect(on).toEqual({ available: true, sharing: { via: 'lan', link: `http://127.0.0.1:${port}/?token=${token}` } });
    expect((await local('GET')).json().sharing).toEqual(on.sharing);

    // The phone scans the link, gets paired, and is in.
    const paired = await get(port, `/?token=${token}`);
    expect(paired.status).toBe(302);
    const cookie = paired.headers['set-cookie']![0]!.split(';')[0]!;
    expect((await get(port, '/', { cookie })).status).toBe(200);
    // ...but can't read the link or switch phone access itself.
    expect((await get(port, '/api/phone', { cookie })).status).toBe(403);
  });

  it('closes to phones again', async () => {
    const { port, local } = await cafe();
    await local('POST', { via: 'lan' });
    expect((await local('DELETE')).json()).toEqual({ available: true, sharing: null });
    await expect(get(port, '/')).rejects.toThrow(/ECONNREFUSED/);
  });

  it('says why it can’t open', async () => {
    const { local } = await cafe();
    const res = await local('POST', { via: 'nowhere' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'No Tailscale address on this computer.' });
    expect((await local('GET')).json().sharing).toBeNull();
  });

  it('is unavailable without a data folder (pnpm dev)', async () => {
    const { local } = await cafe({ withData: false });
    expect((await local('GET')).json()).toEqual({ available: false, sharing: null });
    expect((await local('POST', { via: 'lan' })).statusCode).toBe(400);
  });
});
