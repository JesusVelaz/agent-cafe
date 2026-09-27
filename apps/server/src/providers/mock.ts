/**
 * Demo provider. Produces believable agent runs (tool calls, streaming text, token
 * usage, the occasional failure) with no API key, so every café state can be
 * shown and tested offline. Outputs are clearly labelled as demo output.
 */
import type { ToolName } from '@agent-cafe/shared';
import {
  AdapterError,
  sleep as realSleep,
  type NeutralMessage,
  type ProviderAdapter,
  type ToolCall,
  type TurnRequest,
  type TurnResult,
} from './types.js';

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32) so tests and demos are reproducible. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export interface MockOptions {
  rng?: Rng;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Chance per turn of a simulated provider error. */
  failRate?: number;
  /** Multiplies all delays (tests use 0 via `sleep`, demos can speed up). */
  speed?: number;
}

interface PlannedCall {
  name: ToolName;
  input: Record<string, unknown>;
}

const ARITHMETIC = /\(?\s*-?\d+(?:\.\d+)?(?:\s*[-+*/^%]\s*\(?\s*-?\d+(?:\.\d+)?\s*\)?)+\)?/;

/** Decide which tools a run uses, from keywords in the prompt (stable per prompt). */
function planFor(prompt: string): PlannedCall[] {
  const p = prompt.toLowerCase();
  const rng = seededRng(hash(prompt));
  const plan: PlannedCall[] = [];
  const math = ARITHMETIC.exec(prompt);
  if (math) plan.push({ name: 'calculator', input: { expression: math[0].trim() } });
  if (/\bfiles?\b|readme|docs?|code|repo|folder/.test(p)) {
    plan.push({ name: 'list_files', input: {} }, { name: 'read_file', input: { path: 'README.md' } });
  }
  if (/remember|note|save|memo|archive/.test(p)) {
    const key = p.match(/[a-z]{4,}/g)?.[0] ?? 'memo';
    plan.push({ name: 'notes_write', input: { key, content: prompt.slice(0, 200) } });
  }
  if (/recall|what did|notes?\b|memory/.test(p)) plan.push({ name: 'notes_read', input: {} });
  if (/time|date|today|deadline|schedule/.test(p)) plan.push({ name: 'current_time', input: {} });
  if (plan.length === 0) {
    // Generic prompts still get a little activity so the café stays lively.
    const flavour: PlannedCall[] = [
      { name: 'notes_read', input: {} },
      { name: 'current_time', input: {} },
      { name: 'list_files', input: {} },
    ];
    const n = Math.floor(rng() * 3); // 0–2 flavour calls
    for (let i = 0; i < n; i++) plan.push(flavour[Math.floor(rng() * flavour.length)]!);
  }
  return plan.slice(0, 4);
}

const THINKING_LINES = [
  'Let me check that.',
  'One moment, grabbing what I need.',
  'I will look this up first.',
  'Pulling the relevant details.',
];

function finalAnswer(prompt: string, messages: NeutralMessage[]): string {
  const results = messages
    .filter((m): m is Extract<NeutralMessage, { role: 'tool' }> => m.role === 'tool')
    .flatMap((m) => m.results);
  const findings = results
    .map((r) => `- ${r.name}: ${r.isError ? `failed (${r.output})` : r.output.split('\n')[0]!.slice(0, 120)}`)
    .join('\n');
  const topic = prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt;
  return [
    `Here's my take on "${topic}".`,
    findings ? `\nWhat I gathered:\n${findings}` : '',
    '\nSummary: task handled end to end. In live mode a real model would write this answer.',
    '\n_(Demo output from the mock provider.)_',
  ].join('');
}

const estimateTokens = (s: string) => Math.max(1, Math.ceil(s.length / 4));

export class MockAdapter implements ProviderAdapter {
  readonly kind = 'mock' as const;
  private readonly rng: Rng;
  private readonly sleep: NonNullable<MockOptions['sleep']>;
  private readonly failRate: number;
  private readonly speed: number;

  constructor(opts: MockOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.sleep = opts.sleep ?? realSleep;
    this.failRate = opts.failRate ?? 0.08;
    this.speed = opts.speed ?? 1;
  }

  async testConnection() {
    return { ok: true, message: 'Mock provider is always available.' };
  }

  async runTurn(req: TurnRequest, signal: AbortSignal, onDelta: (t: string) => void): Promise<TurnResult> {
    const firstUser = req.messages.find((m) => m.role === 'user');
    const prompt = firstUser?.role === 'user' ? firstUser.content : '';
    const turnIndex = req.messages.filter((m) => m.role === 'assistant').length;
    const plan = planFor(prompt);

    // "Thinking" time before anything streams.
    await this.sleep((500 + this.rng() * 1200) * this.speed, signal);
    if (this.rng() < this.failRate) {
      throw new AdapterError('Simulated provider error: the espresso machine jammed (mock mode).');
    }

    const next = plan[turnIndex];
    const text = next ? THINKING_LINES[Math.floor(this.rng() * THINKING_LINES.length)]! : finalAnswer(prompt, req.messages);

    // Stream in word-ish chunks.
    const chunks = text.match(/\S+\s*|\s+/g) ?? [text];
    for (const chunk of chunks) {
      await this.sleep((20 + this.rng() * 45) * this.speed, signal);
      onDelta(chunk);
    }

    const toolCalls: ToolCall[] = next
      ? [{ id: `mock_${turnIndex}_${Math.floor(this.rng() * 1e9).toString(36)}`, ...next }]
      : [];
    const history = JSON.stringify(req.messages) + req.system + JSON.stringify(req.tools);
    return {
      text,
      toolCalls,
      usage: {
        inputTokens: estimateTokens(history),
        outputTokens: estimateTokens(text) + toolCalls.length * 25,
      },
      stop: toolCalls.length ? 'tool_use' : 'end',
    };
  }
}
