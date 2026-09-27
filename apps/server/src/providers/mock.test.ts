import { describe, expect, it } from 'vitest';
import { createToolRegistry } from '../tools/registry.js';
import { MockAdapter, seededRng } from './mock.js';
import type { NeutralMessage, TurnRequest } from './types.js';

const tools = createToolRegistry({ db: null as never, workspaceDir: '.' }).specs;
const instant = async () => {};

function req(messages: NeutralMessage[]): TurnRequest {
  return { model: 'claude-sonnet-5', system: 'be nice', messages, tools, maxOutputTokens: 1000 };
}

describe('MockAdapter', () => {
  it('uses the calculator for arithmetic prompts, then answers', async () => {
    const mock = new MockAdapter({ rng: seededRng(1), sleep: instant, failRate: 0 });
    const signal = new AbortController().signal;
    const messages: NeutralMessage[] = [{ role: 'user', content: 'What is 12*7 + 3?' }];

    const first = await mock.runTurn(req(messages), signal, () => {});
    expect(first.stop).toBe('tool_use');
    expect(first.toolCalls[0]).toMatchObject({ name: 'calculator', input: { expression: '12*7 + 3' } });

    messages.push({ role: 'assistant', text: first.text, toolCalls: first.toolCalls });
    messages.push({
      role: 'tool',
      results: [{ callId: first.toolCalls[0]!.id, name: 'calculator', output: '87', isError: false }],
    });

    let streamed = '';
    let turn = await mock.runTurn(req(messages), signal, (d) => (streamed += d));
    // Plans may include extra (flavour) tools; drain them.
    for (let i = 0; i < 5 && turn.stop === 'tool_use'; i++) {
      messages.push({ role: 'assistant', text: turn.text, toolCalls: turn.toolCalls });
      messages.push({
        role: 'tool',
        results: turn.toolCalls.map((c) => ({ callId: c.id, name: c.name, output: 'ok', isError: false })),
      });
      streamed = '';
      turn = await mock.runTurn(req(messages), signal, (d) => (streamed += d));
    }
    expect(turn.stop).toBe('end');
    expect(turn.text).toContain('87');
    expect(streamed).toBe(turn.text);
    expect(turn.usage.inputTokens).toBeGreaterThan(0);
    expect(turn.usage.outputTokens).toBeGreaterThan(0);
  });

  it('fails on demand', async () => {
    const mock = new MockAdapter({ rng: seededRng(1), sleep: instant, failRate: 1 });
    await expect(
      mock.runTurn(req([{ role: 'user', content: 'hi' }]), new AbortController().signal, () => {}),
    ).rejects.toThrow(/simulated/i);
  });

  it('rejects with AbortError when cancelled', async () => {
    const mock = new MockAdapter({ rng: seededRng(1), failRate: 0 }); // real sleeps
    const ctrl = new AbortController();
    const p = mock.runTurn(req([{ role: 'user', content: 'hi' }]), ctrl.signal, () => {});
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});
