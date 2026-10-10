import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Remote access (phones over Tailscale or Wi-Fi). The café's own loopback listener stays as it
 * is; a second listener on the remote address serves the same app, and every request that comes
 * in through it must carry the pairing token: once in the pairing link (`?token=`), which trades
 * it for a cookie, and as that cookie from then on.
 */
export interface RemoteAccess {
  /** The address phones connect to, e.g. a Tailscale or Wi-Fi IP of this computer. */
  host: string;
  /** The long random secret in the pairing link. */
  token: string;
}

const COOKIE = 'cafe_pair';
const ONE_YEAR_S = 365 * 24 * 60 * 60;
const viaRemote = Symbol('agent-cafe.remote');
type Marked = IncomingMessage & { [viaRemote]?: true };

/** `host:port` as it appears in a URL or a Host header (IPv6 in brackets). */
export const hostPort = (host: string, port: number) => `${host.includes(':') ? `[${host}]` : host}:${port}`;

/** The request handler for the remote listener: the app's own, with each request marked as remote. */
export function remoteHandler(app: FastifyInstance) {
  return (req: IncomingMessage, res: ServerResponse) => {
    (req as Marked)[viaRemote] = true;
    app.routing(req, res);
  };
}

export const isRemote = (req: FastifyRequest) => (req.raw as Marked)[viaRemote] === true;

function sameSecret(given: string | undefined, token: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

const NOT_PAIRED = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Café</title>
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;padding:24px;background:#16161d;color:#ece6da;font:16px/1.5 system-ui,sans-serif;text-align:center}h1{font-size:22px;margin:0 0 8px}p{margin:0;max-width:26em;color:#b5ad9f}</style>
</head><body><main><h1>This device isn't paired</h1>
<p>On your computer, find the window running <code>agent-cafe</code> and scan its QR code with this device's camera.</p>
</main></body></html>`;

function refuse(req: FastifyRequest, reply: FastifyReply) {
  if (req.url.startsWith('/api/')) return reply.code(401).send({ error: 'This device isn’t paired with the café.' });
  return reply.code(401).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(NOT_PAIRED);
}

/** Requires pairing for requests that came in through the remote listener. */
export function requirePairing(app: FastifyInstance, remote: () => RemoteAccess | undefined) {
  app.addHook('onRequest', async (req, reply) => {
    if (!isRemote(req)) return;
    // Phone access was just turned off: the listener is closing, so nothing gets through.
    const token = remote()?.token;
    if (!token) return refuse(req, reply);
    const url = new URL(req.url, 'http://cafe');
    const offered = url.searchParams.get('token');
    if (offered !== null) {
      if (!sameSecret(offered, token)) return refuse(req, reply);
      // Trade the link for a cookie, and take the secret out of the address bar and history.
      url.searchParams.delete('token');
      return reply
        .header('set-cookie', `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${ONE_YEAR_S}; HttpOnly; SameSite=Lax`)
        .header('cache-control', 'no-store')
        .redirect(`${url.pathname}${url.search}`, 302);
    }
    if (!sameSecret(cookie(req, COOKIE), token)) return refuse(req, reply);
  });
}
