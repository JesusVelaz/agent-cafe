import { describe, expect, it } from 'vitest';
import { exchangeMessage } from './exchange';

describe('exchangeMessage', () => {
  it('shows only the teammate answer for an existing result', () => {
    expect(exchangeMessage({ exchangeKind: 'result', prompt: '[Delegation result from Earl (anthropic), task legacy: completed]\ntest\n\nContinue the original request using this result. Other delegated tasks may still be pending.' })).toBe('test');
  });
  it('preserves multiline results and strips only the legacy wrapper', () => {
    expect(exchangeMessage({ exchangeKind: 'result', prompt: '[Delegation result from Chai (openai), task legacy: failed]\nUnavailable model.\nPick another one.\n\nContinue the original request using this result. Other delegated tasks may still be pending.' })).toBe('Unavailable model.\nPick another one.');
    expect(exchangeMessage({ exchangeKind: 'delegation', prompt: '[Delegated task from Ben (anthropic), task legacy]\nSay test' })).toBe('Say test');
  });
  it('never edits user messages or structured exchange content', () => {
    const prompt = '[Delegation result from Earl (anthropic), task legacy: completed]\ntest\n\nContinue the original request using this result. Other delegated tasks may still be pending.';
    expect(exchangeMessage({ prompt })).toBe(prompt);
    expect(exchangeMessage({ prompt, exchangeKind: 'result', exchange: { senderName: 'Earl', senderProviderId: 'anthropic' } })).toBe(prompt);
  });
});
