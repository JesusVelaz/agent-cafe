import { describe, expect, it } from 'vitest';
import { FakeCodexServer, FakeRpcError } from '../test/fakeCodex.js';
import { CodexRpc, CodexRpcError, RpcReplyError } from './codexRpc.js';

function connect(srv = new FakeCodexServer(), handlers: ConstructorParameters<typeof CodexRpc>[1] = {}, timeoutMs?: number) {
  return { srv, rpc: new CodexRpc(srv.spawn('codex', ['app-server']), handlers, timeoutMs) };
}

describe('CodexRpc', () => {
  it('matches replies to requests by id, even out of order', async () => {
    const srv = new FakeCodexServer()
      .on('slow', () => new Promise((r) => setTimeout(() => r({ n: 'slow' }), 20)))
      .on('fast', () => ({ n: 'fast' }));
    const { rpc } = connect(srv);
    const [a, b] = await Promise.all([rpc.request('slow', {}), rpc.request('fast', {})]);
    expect([a, b]).toEqual([{ n: 'slow' }, { n: 'fast' }]);
    const ids = srv.received.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    await rpc.close();
  });

  it('writes one JSON message per line without a jsonrpc field', async () => {
    const { srv, rpc } = connect();
    await rpc.request('initialize', { clientInfo: { name: 't' } });
    rpc.notify('initialized');
    await new Promise((r) => setTimeout(r, 5));
    expect(srv.received[0]).toEqual({ id: 1, method: 'initialize', params: { clientInfo: { name: 't' } } });
    expect(srv.received[1]).toEqual({ method: 'initialized' });
    await rpc.close();
  });

  it('turns error replies into errors, and spots unsupported methods', async () => {
    const srv = new FakeCodexServer().on('bad', () => {
      throw new FakeRpcError(-32602, 'bad params');
    });
    const { rpc } = connect(srv);
    await expect(rpc.request('bad', {})).rejects.toMatchObject({ kind: 'rpc', code: -32602, message: 'bad params' });
    await expect(rpc.request('nope/missing', {})).rejects.toMatchObject({ kind: 'unsupported', method: 'nope/missing' });
    await rpc.close();
  });

  it('times out a request that gets no reply', async () => {
    const srv = new FakeCodexServer().on('hang', () => new Promise(() => {}));
    const { rpc } = connect(srv, {}, 30);
    await expect(rpc.request('hang', {})).rejects.toMatchObject({ kind: 'timeout' });
    await rpc.close();
  });

  it('rejects everything pending when the process exits, with its stderr', async () => {
    const srv = new FakeCodexServer().on('hang', () => new Promise(() => {}));
    const { rpc } = connect(srv);
    const pending = rpc.request('hang', {});
    srv.stderr('thread panicked: out of cheese');
    await new Promise((r) => setTimeout(r, 5));
    srv.exit(101);
    const err = (await pending.catch((e: unknown) => e)) as CodexRpcError;
    expect(err.kind).toBe('exited');
    expect(err.message).toMatch(/exited with code 101: thread panicked: out of cheese/);
    expect((await rpc.exited).code).toBe(101);
    await expect(rpc.request('late', {})).rejects.toMatchObject({ kind: 'exited' });
    expect(rpc.isAlive).toBe(false);
  });

  it('answers server requests, including with errors', async () => {
    const { srv, rpc } = connect(new FakeCodexServer(), {
      onRequest: async (method) => {
        if (method === 'item/commandExecution/requestApproval') return { decision: 'accept' };
        throw new RpcReplyError(-32601, `no ${method}`);
      },
    });
    expect((await srv.request('item/commandExecution/requestApproval', {})).result).toEqual({ decision: 'accept' });
    expect((await srv.request('item/tool/call', {})).error).toEqual({ code: -32601, message: 'no item/tool/call' });
    await rpc.close();
  });

  it('reports malformed lines and keeps going', async () => {
    const bad: string[] = [];
    const notes: string[] = [];
    const { srv, rpc } = connect(new FakeCodexServer(), { onMalformed: (l) => bad.push(l), onNotification: (m) => notes.push(m) });
    srv.writeRaw('not json {');
    srv.writeRaw('[1,2]');
    srv.writeRaw('{"id": 99, "result": {}}'); // a reply nobody is waiting for: ignored
    srv.notify('turn/started', {});
    await new Promise((r) => setTimeout(r, 10));
    expect(bad).toEqual(['not json {', '[1,2]']);
    expect(notes).toEqual(['turn/started']);
    expect(await rpc.request('initialize', {})).toMatchObject({ platformOs: 'windows' });
    await rpc.close();
  });

  it('closes by ending stdin, and kills a process that lingers', async () => {
    const { srv, rpc } = connect();
    expect((await rpc.close()).code).toBe(0);
    expect(srv.killed).toBe(false);

    const stubborn = new FakeCodexServer();
    const child = stubborn.spawn('codex', []);
    child.stdin.removeAllListeners('finish'); // ignores EOF
    const r2 = new CodexRpc(child);
    await r2.close(10);
    expect(stubborn.killed).toBe(true);
  });
});
