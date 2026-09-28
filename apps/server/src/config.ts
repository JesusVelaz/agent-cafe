import { isAbsolute, resolve } from 'node:path';
import { REPO_ROOT } from './paths.js';

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  /** Read-only sandbox for the demo runs' file tools. */
  workspaceDir: string;
}

const fromRepo = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  return {
    // Deliberately not configurable: this server drives agents that can edit your files.
    host: '127.0.0.1',
    // Own variable, not PORT: dev tooling sets PORT for the web app.
    port: Number(env.CAFE_API_PORT || 4318),
    workspaceDir: fromRepo(env.WORKSPACE_DIR?.trim() || 'workspace'),
  };
}

/** The web UI's origins. The API is only reachable from these (plus direct localhost tools). */
export const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];
