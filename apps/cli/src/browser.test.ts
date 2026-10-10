import { describe, expect, it } from 'vitest';
import { findPort, type PortUse } from './browser.js';

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
