/**
 * Scripted agent runs for the demo site: believable coding-agent steps (reading,
 * searching, editing, running tests) chosen from keywords in the prompt. Nothing
 * here calls a model; every answer says it's a demo.
 */
import type { ProviderId } from '@agent-cafe/shared';

export type Rng = () => number;

/** Small deterministic PRNG (mulberry32), so seeded threads look the same on every visit. */
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

export const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

export interface DemoTool {
  name: string;
  input: Record<string, unknown>;
  output: string;
  /** Asks the user first (Allow / Deny) when the run may ask. */
  ask?: { summary: string; reason: string | null };
}

/** One model turn: what the agent says, then the tool it uses (none on the last turn). */
export interface DemoStep {
  text: string;
  tool?: DemoTool;
}

const FILES = {
  prices: 'src/menu/prices.ts',
  board: 'src/ui/MenuBoard.tsx',
  queue: 'src/orders/queue.ts',
  routes: 'src/api/routes.ts',
  test: 'tests/orders.test.ts',
  readme: 'README.md',
} as const;

const pick = <T,>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

type Topic = 'fix' | 'test' | 'docs' | 'review' | 'search' | 'build';

function topicOf(prompt: string): Topic {
  const p = prompt.toLowerCase();
  if (/\b(bug|fix|broken|error|crash|fail|flaky)/.test(p)) return 'fix';
  if (/\btests?\b|coverage/.test(p)) return 'test';
  if (/readme|docs?\b|document|explain|write ?up|summar|checklist/.test(p)) return 'docs';
  if (/review|audit|check|edge case/.test(p)) return 'review';
  if (/\b(find|where|search|look for|which)\b/.test(p)) return 'search';
  return 'build';
}

const read = (path: string, output: string): DemoTool => ({ name: 'Read', input: { file_path: path }, output });
const grep = (pattern: string, output: string): DemoTool => ({ name: 'Grep', input: { pattern }, output });
const edit = (path: string, output: string): DemoTool => ({ name: 'Edit', input: { file_path: path }, output });
const bash = (command: string, output: string, reason: string): DemoTool => ({
  name: 'Bash',
  input: { command },
  output,
  ask: { summary: command, reason },
});

const SOURCE: Record<string, string> = {
  [FILES.prices]: "export const PRICES = { latte: 4.5, mocha: 4.9, chai: 4.2 };\nexport const withTax = (n: number) => round(n * 1.08);",
  [FILES.board]: 'export function MenuBoard({ items }: Props) {\n  return <ul className="board">{items.map(renderItem)}</ul>;\n}',
  [FILES.queue]: 'export class OrderQueue {\n  private orders: Order[] = [];\n  push(o: Order) { this.orders.push(o); }\n  next() { return this.orders.shift(); }\n}',
  [FILES.routes]: "app.post('/orders', async (req) => queue.push(parseOrder(req.body)));",
  [FILES.test]: "it('serves orders in the order they came in', async () => {\n  await placeOrders(3);\n  expect(served()).toEqual([1, 2, 3]);\n});",
  [FILES.readme]: '# Corner Café\n\nThe ordering app for the café on the corner. Run `pnpm dev` and open http://localhost:3000.',
};

function plan(topic: Topic, rng: Rng): { steps: DemoStep[]; answer: string } {
  const opener = pick(rng, ['Let me look around first.', 'Starting with the code that matters here.', 'I will get my bearings first.']);
  switch (topic) {
    case 'fix':
      return {
        steps: [
          { text: opener, tool: grep('OrderQueue', `${FILES.queue}:1\n${FILES.routes}:3\n${FILES.test}:4`) },
          { text: 'The queue is the likely culprit. Reading it.', tool: read(FILES.queue, SOURCE[FILES.queue]!) },
          { text: 'Two orders placed in the same tick can be served out of turn. Fixing the ordering.', tool: edit(FILES.queue, 'Updated 6 lines: orders now carry a sequence number and are served by it.') },
          { text: 'Running the order tests to confirm.', tool: bash('pnpm test orders', '✓ tests/orders.test.ts (6 tests) 412ms\n\nTest Files  1 passed (1)\nTests  6 passed (6)', 'Runs the test suite') },
        ],
        answer: `Fixed. Orders placed in the same tick could be served out of turn because \`OrderQueue\` relied on insertion timing. Each order now carries a sequence number and \`next()\` serves by it (\`${FILES.queue}\`). The order tests pass (6 of 6).`,
      };
    case 'test':
      return {
        steps: [
          { text: opener, tool: read(FILES.test, SOURCE[FILES.test]!) },
          { text: 'Adding cases for an empty queue and for a cancelled order.', tool: edit(FILES.test, 'Added 2 tests: empty queue returns undefined; cancelled orders are skipped.') },
          { text: 'Running them.', tool: bash('pnpm test orders', '✓ tests/orders.test.ts (8 tests) 455ms\n\nTests  8 passed (8)', 'Runs the test suite') },
        ],
        answer: `Added two tests to \`${FILES.test}\`: an empty queue returns nothing, and cancelled orders are skipped. All 8 order tests pass.`,
      };
    case 'docs':
      return {
        steps: [
          { text: opener, tool: read(FILES.readme, SOURCE[FILES.readme]!) },
          { text: 'Checking how the app actually starts so the steps are right.', tool: read('package.json', '{ "scripts": { "dev": "next dev", "test": "vitest run" } }') },
          { text: 'Rewriting the intro.', tool: edit(FILES.readme, 'Replaced the intro with a three-step quick start and a short "what is where" list.') },
        ],
        answer: `Done. The README now opens with a three-step quick start (install, \`pnpm dev\`, open the page) and a short map of where the menu, orders and API code live.`,
      };
    case 'review':
      return {
        steps: [
          { text: opener, tool: read(FILES.routes, SOURCE[FILES.routes]!) },
          { text: 'Following an order from the route into the queue.', tool: read(FILES.queue, SOURCE[FILES.queue]!) },
          { text: 'Checking how prices are rounded.', tool: read(FILES.prices, SOURCE[FILES.prices]!) },
        ],
        answer: [
          'Three things worth fixing:',
          `1. \`POST /orders\` accepts an empty item list (\`${FILES.routes}\`).`,
          '2. A cancelled order is still served by `OrderQueue.next()`.',
          `3. Tax is rounded per item, so a big order can be off by a cent (\`${FILES.prices}\`).`,
          'Nothing else stood out.',
        ].join('\n'),
      };
    case 'search':
      return {
        steps: [
          { text: opener, tool: grep('queue\\.(push|next)', `${FILES.routes}:3\n${FILES.queue}:3\n${FILES.queue}:4\nsrc/legacy/register.ts:41`) },
          { text: 'One hit is in a legacy file. Reading it.', tool: read('src/legacy/register.ts', '// TODO: move to OrderQueue\nconst queue: Order[] = [];') },
        ],
        answer: `It's used in two places: the API route (\`${FILES.routes}\`) and one leftover in \`src/legacy/register.ts\`, which still keeps its own array instead of using \`OrderQueue\`.`,
      };
    case 'build':
      return {
        steps: [
          { text: opener, tool: { name: 'Glob', input: { pattern: 'src/**/*.tsx' }, output: `${FILES.board}\nsrc/ui/OrderTicket.tsx\nsrc/ui/Layout.tsx` } },
          { text: 'The menu board is where this goes.', tool: read(FILES.board, SOURCE[FILES.board]!) },
          { text: 'Making the change.', tool: edit(FILES.board, 'Updated 14 lines: items are grouped by category with a small heading each.') },
          { text: 'Type-checking.', tool: bash('pnpm typecheck', 'Done. No errors.', 'Runs the type checker') },
        ],
        answer: `Done. The menu board now groups items by category with a heading for each (\`${FILES.board}\`), and the project type-checks cleanly.`,
      };
  }
}

/** Codex works through a shell and patches; Claude Code through its own tools. */
function forFloor(tool: DemoTool, providerId: ProviderId): DemoTool {
  if (providerId === 'anthropic') return tool;
  if (tool.name === 'Edit') return { ...tool, name: 'apply_patch' };
  const command =
    tool.name === 'Bash' ? String(tool.input.command)
    : tool.name === 'Read' ? `cat ${String(tool.input.file_path)}`
    : tool.name === 'Grep' ? `rg '${String(tool.input.pattern)}'`
    : tool.name === 'Glob' ? `rg --files -g '${String(tool.input.pattern)}'`
    : tool.name;
  return { ...tool, name: 'shell', input: { command } };
}

export const DEMO_NOTE = '(Demo run: scripted, no model was called.)';

/** The run for `prompt`: steps with tools, then the answer. Stable for a given prompt and rng. */
export function scriptFor(prompt: string, providerId: ProviderId, rng: Rng = seededRng(hash(prompt))): DemoStep[] {
  const { steps, answer } = plan(topicOf(prompt), rng);
  return [
    ...steps.map((s) => (s.tool ? { ...s, tool: forFloor(s.tool, providerId) } : s)),
    { text: `${answer}\n\n${DEMO_NOTE}` },
  ];
}
