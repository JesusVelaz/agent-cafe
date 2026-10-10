import { isAbsolute, resolve } from 'node:path';
import { REPO_ROOT } from './paths.js';

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  /** Read-only sandbox for the demo runs' file tools. */
  workspaceDir: string;
  /**
   * The built web UI, served on the same port as the API (`pnpm start`, the `agent-cafe` command).
   * Unset under `pnpm dev`, where Next serves the UI on :3000.
   */
  webDir?: string;
}

const fromRepo = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    // Deliberately not configurable: this server drives agents that can edit your files.
    host: '127.0.0.1',
    // Own variable, not PORT: dev tooling sets PORT for the web app.
    port: Number(env.CAFE_API_PORT || 4318),
    workspaceDir: fromRepo(env.WORKSPACE_DIR?.trim() || 'workspace'),
    ...(env.CAFE_WEB_DIR?.trim() ? { webDir: fromRepo(env.CAFE_WEB_DIR.trim()) } : {}),
  };
}

/**
 * The web UI's origins. The API is only reachable from these (plus direct localhost tools):
 * the dev UI on :3000, and the server's own port when it serves the built UI itself.
 */
export function allowedOrigins(port?: number): string[] {
  const ports = port ? [3000, port] : [3000];
  return ports.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);
}
