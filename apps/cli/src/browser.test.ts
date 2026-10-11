import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { findPort, probe, type PortUse } from './browser.js';

const ports = (uses: Record<number, PortUse>) => async (port: number) => uses[port] ?? 'free';

describe('findPort', () => {
  it('takes the first free port, stepping past busy ones', async () => {
    expect(await findPort(4318, 10, ports({ 4318: 'taken', 4319: 'dev' }))).toEqual({
      port: 4320,
      use: 'free',
      busy: [
        { port: 4318, use: 'taken' },
        { port: 4319, use: 'dev' },
      ],
    });
  });

  it('reuses a café that is already open', async () => {
    expect(await findPort(4318, 10, ports({ 4318: 'taken', 4319: 'cafe' }))).toMatchObject({ port: 4319, use: 'cafe' });
  });

  it('gives up after the ports it may try', async () => {
    const found = await findPort(4318, 1, ports({ 4318: 'taken' }));
    expect(found.port).toBeUndefined();
    expect(found.busy).toEqual([{ port: 4318, use: 'taken' }]);
  });
});

describe('probe', () => {
  const serve = async (handler: (path: string) => { type: string; body: string }) => {
    const server = createServer((req, res) => {
      const { type, body } = handler(req.url ?? '/');
      res.writeHead(200, { 'content-type': type }).end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => server.close() };
  };
  const cafe = (ui: boolean) => (path: string) =>
    path === '/api/health'
      ? { type: 'application/json', body: JSON.stringify({ ok: true, app: 'agent-cafe' }) }
      : ui
        ? { type: 'text/html', body: '<!doctype html>' }
        : { type: 'application/json', body: '{}' };

  it('recognises a café, with and without its UI', async () => {
    for (const [ui, use] of [[true, 'cafe'], [false, 'dev']] as const) {
      const server = await serve(cafe(ui));
      expect(await probe(server.url)).toBe(use);
      server.close();
    }
  });

  it('does not mistake another web app for a café', async () => {
    const server = await serve(() => ({ type: 'text/html', body: '<!doctype html><title>Some other app</title>' }));
    expect(await probe(server.url)).toBe('taken');
    server.close();
  });
});
