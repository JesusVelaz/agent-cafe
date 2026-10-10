import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CliError, DEFAULT_PORT, parseCliArgs } from './options.js';

describe('parseCliArgs', () => {
  it('defaults to the café port, ~/.agent-cafe and opening the browser', () => {
    expect(parseCliArgs([], {})).toEqual({
      port: DEFAULT_PORT,
      dataDir: join(homedir(), '.agent-cafe'),
      openBrowser: true,
      help: false,
      version: false,
    });
  });

  it('reads the flags', () => {
    expect(parseCliArgs(['-p', '5000', '--data-dir', 'cafe-data', '--no-browser'], {})).toMatchObject({
      port: 5000,
      dataDir: resolve('cafe-data'),
      openBrowser: false,
    });
    expect(parseCliArgs(['--port=5001'], {}).port).toBe(5001);
    expect(parseCliArgs(['-h'], {}).help).toBe(true);
    expect(parseCliArgs(['--version'], {}).version).toBe(true);
  });

  it('falls back to environment variables, with flags winning', () => {
    const env = { AGENT_CAFE_PORT: '6000', AGENT_CAFE_HOME: '/tmp/cafe' };
    expect(parseCliArgs([], env)).toMatchObject({ port: 6000, dataDir: resolve('/tmp/cafe') });
    expect(parseCliArgs(['-p', '6001'], env).port).toBe(6001);
  });

  it('rejects bad ports and unknown flags', () => {
    for (const port of ['0', '65536', 'abc', '80.5', '']) expect(() => parseCliArgs(['--port', port], {})).toThrow(CliError);
    expect(() => parseCliArgs(['--host', '0.0.0.0'], {})).toThrow(CliError);
  });
});
