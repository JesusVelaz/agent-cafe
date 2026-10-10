import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export const DEFAULT_PORT = 4318;

export const HELP = `Agent Café: watch your Claude Code and Codex agents work, in your browser.

Usage: agent-cafe [options]

Options:
  -p, --port <port>     Port to serve the café on (default ${DEFAULT_PORT})
      --host <where>    Also open the café to your phone and other devices you pair:
                          tailscale  your Tailscale address (works anywhere, encrypted)
                          lan        your Wi-Fi / home network address (at home only)
                          <address>  one of this computer's addresses
      --new-token       Make a new pairing code; devices paired before must scan again
      --data-dir <dir>  Where the café keeps its data (default ~/.agent-cafe)
      --no-browser      Don't open the café in your browser
  -h, --help            Show this help
  -v, --version         Show the version

Without --host, the café only listens on this computer (127.0.0.1).`;

export interface CliOptions {
  port: number;
  /** The port came from --port or AGENT_CAFE_PORT. Otherwise the café may move to a free one. */
  portChosen: boolean;
  /** tailscale | lan | an address. Unset: this computer only. */
  host?: string;
  newToken: boolean;
  dataDir: string;
  openBrowser: boolean;
  help: boolean;
  version: boolean;
}

export class CliError extends Error {}

export function parseCliArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        port: { type: 'string', short: 'p' },
        host: { type: 'string' },
        'new-token': { type: 'boolean', default: false },
        'data-dir': { type: 'string' },
        'no-browser': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
      },
    }));
  } catch (err) {
    throw new CliError((err as Error).message);
  }
  const rawPort = values.port ?? env.AGENT_CAFE_PORT ?? String(DEFAULT_PORT);
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) throw new CliError(`Invalid port: ${rawPort}`);
  const host = values.host?.trim();
  if (values.host !== undefined && !host) throw new CliError('--host needs a value: tailscale, lan or an address');
  return {
    port,
    portChosen: values.port !== undefined || env.AGENT_CAFE_PORT !== undefined,
    ...(host ? { host } : {}),
    newToken: values['new-token'],
    dataDir: resolve(values['data-dir'] ?? env.AGENT_CAFE_HOME ?? join(homedir(), '.agent-cafe')),
    openBrowser: !values['no-browser'],
    help: values.help,
    version: values.version,
  };
}
