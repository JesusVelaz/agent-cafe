import { spawn } from 'node:child_process';

/** Opens the URL in the default browser. Best effort: on a machine without one, nothing happens. */
export function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** What already answers on this URL: a café serving its UI, something else, or nothing. */
export async function probe(url: string): Promise<'cafe' | 'taken' | 'free'> {
  try {
    const health = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1500) });
    if (!health.ok) return 'taken';
    const page = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return page.ok && page.headers.get('content-type')?.startsWith('text/html') ? 'cafe' : 'taken';
  } catch (err) {
    return (err as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED' ? 'free' : 'taken';
  }
}
