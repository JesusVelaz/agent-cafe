/**
 * The demo site's starting café: the usual six agents, two made-up projects and a
 * few finished threads (one with a delegation, one retried after a failure), so
 * there's something to open before anything has run.
 */
import type { ProviderId } from '@agent-cafe/shared';
import { DemoCafe } from './cafe';
import { DEMO_NOTE, type DemoStep } from './script';

const BASE = 'You are a helpful agent working in Agents Café. Use tools when they help. Be concise.';

const AGENTS: Array<{ name: string; providerId: ProviderId; model: string; spriteSeed: number; systemPrompt: string }> = [
  // Ground floor: OpenAI
  { name: 'Mocha', providerId: 'openai', model: 'gpt-6-sol', spriteSeed: 11, systemPrompt: `${BASE} You enjoy coding tasks.` },
  { name: 'Chai', providerId: 'openai', model: 'gpt-6-luna', spriteSeed: 23, systemPrompt: `${BASE} You are fast and to the point.` },
  { name: 'Biscotti', providerId: 'openai', model: 'gpt-6-astra', spriteSeed: 37, systemPrompt: `${BASE} You research carefully.` },
  // Upstairs: Anthropic
  { name: 'Earl', providerId: 'anthropic', model: 'claude-opus-5', spriteSeed: 41, systemPrompt: `${BASE} You plan and manage.` },
  { name: 'Matcha', providerId: 'anthropic', model: 'claude-sonnet-5', spriteSeed: 53, systemPrompt: `${BASE} You write clearly.` },
  { name: 'Scone', providerId: 'anthropic', model: 'claude-haiku-4-5', spriteSeed: 67, systemPrompt: `${BASE} You keep the archive tidy.` },
];

const MIN = 60_000;

export function seedDemo(cafe: DemoCafe, now = Date.now()): void {
  const storefront = cafe.addProject('corner-cafe', '~/code/corner-cafe');
  const api = cafe.addProject('orders-api', '~/code/orders-api');
  const agent: Record<string, string> = {};
  const created = new Date(now - 3 * 24 * 60 * MIN).toISOString();
  for (const a of AGENTS) {
    agent[a.name] = cafe.addAgent({ ...a, createdAt: created, projectId: a.providerId === 'anthropic' ? storefront.id : api.id }).id;
  }
  const ago = (min: number) => now - min * MIN;

  // Earl plans, hands the price check to Mocha, and finishes with Mocha's result.
  const planSteps: DemoStep[] = [
    { text: 'Reading the current board first.', tool: { name: 'Read', input: { file_path: 'src/ui/MenuBoard.tsx' }, output: 'export function MenuBoard({ items }: Props) { … }' } },
    {
      text: 'Mocha knows the pricing code; asking them to check the maths while I draft the layout.',
      tool: { name: 'mcp__cafe__cafe_delegate_task', input: { agent: 'Mocha', prompt: 'Check the spring prices in src/menu/prices.ts add up with tax.' }, output: 'Queued for Mocha. Their result will continue this conversation.' },
    },
    { text: `Draft is ready: seasonal drinks get their own row at the top, prices stay in the right column. Waiting on Mocha for the numbers.\n\n${DEMO_NOTE}` },
  ];
  const plan = cafe.addPast({ agentId: agent.Earl!, prompt: 'Plan the spring menu board refresh. Get someone to double-check the prices.', at: ago(95), projectId: storefront.id, steps: planSteps, threadTitle: 'Spring menu board', pinned: true });
  const check = cafe.addPast({
    agentId: agent.Mocha!,
    prompt: 'Check the spring prices in src/menu/prices.ts add up with tax.',
    at: ago(93),
    // Delegated work runs in the sender's project.
    projectId: storefront.id,
    exchange: { kind: 'delegation', sourceTaskId: plan.id, rootTaskId: plan.id, meta: { senderName: 'Earl', senderProviderId: 'anthropic' } },
    steps: [
      { text: 'Opening the price table.', tool: { name: 'shell', input: { command: 'cat src/menu/prices.ts' }, output: 'export const PRICES = { latte: 4.5, mocha: 4.9, chai: 4.2 };' } },
      { text: 'Checking the totals with tax.', tool: { name: 'shell', input: { command: 'pnpm test prices' }, output: '✓ tests/prices.test.ts (4 tests) 120ms' } },
      { text: `All three spring prices are right with 8% tax (latte 4.86, mocha 5.29, chai 4.54). The tests agree.\n\n${DEMO_NOTE}` },
    ],
  });
  cafe.addPast({
    agentId: agent.Earl!,
    prompt: 'All three spring prices are right with 8% tax (latte 4.86, mocha 5.29, chai 4.54). The tests agree.',
    at: ago(88),
    projectId: storefront.id,
    continueOf: plan.id,
    exchange: { kind: 'result', sourceTaskId: check.id, rootTaskId: plan.id, resultForTaskId: plan.id, meta: { senderName: 'Mocha', senderProviderId: 'openai', status: 'completed' } },
    steps: [{ text: `Mocha confirmed the prices, so the plan is final: seasonal row on top, three drinks, prices checked.\n\n${DEMO_NOTE}` }],
  });

  cafe.addPast({ agentId: agent.Matcha!, prompt: 'Rewrite the README intro so a new barista can follow it.', at: ago(70), projectId: storefront.id });
  cafe.addPast({ agentId: agent.Scone!, prompt: 'Find where we still use the legacy register.', at: ago(52), projectId: storefront.id });
  cafe.addPast({ agentId: agent.Biscotti!, prompt: 'Review the checkout route for edge cases.', at: ago(40), projectId: api.id });

  // A failure, then a retry that worked.
  const flaky = cafe.addPast({
    agentId: agent.Chai!,
    prompt: 'Fix the flaky test where two orders arrive at once.',
    at: ago(30),
    projectId: api.id,
    failed: { kind: 'provider_error', error: 'Simulated error: the espresso machine jammed. Retry to run it again.' },
  });
  cafe.addPast({ agentId: agent.Chai!, prompt: flaky.prompt, at: ago(27), projectId: api.id, retryOf: flaky.id });
}
