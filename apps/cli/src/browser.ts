import { spawn } from 'node:child_process';
import { request } from 'node:http';

/**
 * Opens the URL in the default browser. Best effort: on a machine without one, nothing happens.
 * Resolves once the browser has started, so the caller can exit without cutting it off.
 */
export function openBrowser(url: string): Promise<void> {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
  child.unref();
  return new Promise((resolve) => {
    child.once('spawn', () => resolve());
    child.once('error', () => resolve());
  });
}

/**
 * A plain HTTP request to the café on this computer. Not fetch: on Windows, exiting after fetch
 * crashes Node with a libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`), and the CLI
 * exits right after talking to an already open café.
 */
export function call(
  url: string,
  init: { method?: string; json?: unknown; timeoutMs?: number } = {},
): Promise<{ status: number; type: string; body: string }> {
  const payload = init.json === undefined ? undefined : JSON.stringify(init.json);
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: init.method ?? 'GET',
        agent: false,
        timeout: init.timeoutMs ?? 1500,
        headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'] ?? '', body }));
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(payload);
  });
}

/** What already answers on this URL: a café serving its UI, something else, or nothing. */
export async function probe(url: string): Promise<'cafe' | 'taken' | 'free'> {
  try {
    const health = await call(`${url}/api/health`);
    if (health.status !== 200) return 'taken';
    const page = await call(url);
    return page.status === 200 && page.type.startsWith('text/html') ? 'cafe' : 'taken';
  } catch (err) {
    return (err as { code?: string }).code === 'ECONNREFUSED' ? 'free' : 'taken';
  }
}
