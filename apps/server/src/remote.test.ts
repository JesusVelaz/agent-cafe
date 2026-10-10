import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { allowedOrigins } from './config.js';
import { hostPort, remoteHandler } from './remote.js';

const TOKEN = 'a'.repeat(64);
let cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanup) await fn();
  cleanup = [];
});

/** The app on a "remote" listener (loopback here, but every request is treated as remote). */
async function remoteCafe(): Promise<{ app: FastifyInstance; port: number }> {
  let handle: ((req: IncomingMessage, res: Parameters<ReturnType<typeof remoteHandler>>[1]) => void) | undefined;
  const server: Server = createServer((req, res) => handle!(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const webDir = mkdtempSync(join(tmpdir(), 'agent-cafe-web-'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Agent Café</title>');
  const app = await buildApp(undefined, { port, webDir, remote: () => ({ host: '127.0.0.1', token: TOKEN }) });
  await app.ready();
  handle = remoteHandler(app);
  cleanup.push(() => server.close(), () => app.close());
  return { app, port };
}

function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: IncomingMessage['headers']; body: string }>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    })
      .on('error', reject)
      .end();
  });
}

describe('remote access', () => {
  it('turns away devices that are not paired', async () => {
    const { port } = await remoteCafe();
    const page = await get(port, '/');
    expect(page.status).toBe(401);
    expect(page.body).toContain('isn\'t paired');
    const api = await get(port, '/api/health');
    expect(api.status).toBe(401);
    expect(JSON.parse(api.body)).toEqual({ error: expect.stringContaining('paired') });
    expect((await get(port, '/', { cookie: `cafe_pair=${'b'.repeat(64)}` })).status).toBe(401);
  });

  it('pairs a device from the link, then knows it by its cookie', async () => {
    const { port } = await remoteCafe();
    const paired = await get(port, `/?token=${TOKEN}`);
    expect(paired.status).toBe(302);
    expect(paired.headers.location).toBe('/');
    const setCookie = paired.headers['set-cookie']![0]!;
    expect(setCookie).toMatch(/^cafe_pair=a{64};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const cookie = setCookie.split(';')[0]!;
    const page = await get(port, '/', { cookie });
    expect(page.status).toBe(200);
    expect(page.body).toContain('Agent Café');
    expect(JSON.parse((await get(port, '/api/health', { cookie })).body)).toEqual({ ok: true });
  });

  it('keeps the rest of the address when it takes the token out', async () => {
    const { port } = await remoteCafe();
    expect((await get(port, `/some/where?x=1&token=${TOKEN}`)).headers.location).toBe('/some/where?x=1');
  });

  it('refuses a wrong pairing link', async () => {
    const { port } = await remoteCafe();
    for (const token of ['wrong', 'a'.repeat(63), '']) {
      const res = await get(port, `/?token=${token}`);
      expect(res.status).toBe(401);
      expect(res.headers['set-cookie']).toBeUndefined();
    }
  });

  it('only answers on its own address', async () => {
    const { port } = await remoteCafe();
    expect((await get(port, `/?token=${TOKEN}`, { host: `evil.example:${port}` })).status).toBe(403);
    expect((await get(port, `/?token=${TOKEN}`, { host: `localhost:${port}` })).status).toBe(403);
  });

  it('leaves this computer alone: local requests need no pairing', async () => {
    const { app, port } = await remoteCafe();
    const res = await app.inject({ url: '/api/health', headers: { host: `127.0.0.1:${port}` } });
    expect(res.statusCode).toBe(200);
    expect((await app.inject({ url: '/api/health', headers: { host: `evil.example:${port}` } })).statusCode).toBe(403);
  });
});

describe('remote origins', () => {
  it("adds the remote address to the café's origins", () => {
    expect(allowedOrigins(4318, '100.64.1.2')).toContain('http://100.64.1.2:4318');
    expect(allowedOrigins(4318, 'fd7a::1')).toContain('http://[fd7a::1]:4318');
    expect(allowedOrigins(4318)).not.toContain('http://100.64.1.2:4318');
    expect(hostPort('fd7a::1', 80)).toBe('[fd7a::1]:80');
  });
});
