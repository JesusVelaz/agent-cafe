import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { ProviderId } from '@agent-cafe/shared';
import { REPO_ROOT } from './paths.js';

export interface ServerConfig {
  host: '127.0.0.1';
  port: number;
  /** Holds master.key. Never inside the repo. */
  homeDir: string;
  /** Read-only sandbox for the file tools. */
  workspaceDir: string;
  /** Keys from the environment/.env. These win over keys stored via the UI. */
  envKeys: Partial<Record<ProviderId, string>>;
}

const fromRepo = (p: string) => (isAbsolute(p) ? p : resolve(REPO_ROOT, p));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const envKeys: Partial<Record<ProviderId, string>> = {};
  if (env.OPENAI_API_KEY?.trim()) envKeys.openai = env.OPENAI_API_KEY.trim();
  if (env.ANTHROPIC_API_KEY?.trim()) envKeys.anthropic = env.ANTHROPIC_API_KEY.trim();
  return {
    // Deliberately not configurable: this is a local tool holding API keys.
    host: '127.0.0.1',
    port: Number(env.PORT || 4318),
    homeDir: env.AGENT_CAFE_HOME?.trim() ? fromRepo(env.AGENT_CAFE_HOME.trim()) : join(homedir(), '.agent-cafe'),
    workspaceDir: fromRepo(env.WORKSPACE_DIR?.trim() || 'workspace'),
    envKeys,
  };
}
