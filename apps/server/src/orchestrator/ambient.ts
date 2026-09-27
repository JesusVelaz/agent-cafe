/**
 * Ambient mode: every so often, an idle agent on a *mock* floor picks up a canned
 * task by itself, so the café looks alive in demos. Never touches live providers,
 * so it can never spend money.
 */
import type { ProviderId } from '@agent-cafe/shared';
import type { Db } from '../db/client.js';
import type { ProviderConfigService } from '../providers/config.js';
import type { SettingsService } from '../settings.js';
import type { Orchestrator } from './orchestrator.js';

export const AMBIENT_PROMPTS = [
  'What is (18 * 4) + 7? Show your working.',
  'Remember that the oat milk delivery comes on Fridays.',
  'Recall any notes the team saved and summarise them.',
  'List the files in the workspace and describe what is there.',
  'What is the date today, and how many days until the weekend?',
  'Draft a two-line welcome sign for the café door.',
  'Plan three steps to reorganise the archive shelf.',
  'Read the workspace README and summarise it in one sentence.',
  'Calculate the cost of 12 lattes at 4.5 each, plus 8% tax: 12 * 4.5 * 1.08',
  'Brainstorm a name for a new seasonal drink.',
];

export class AmbientDriver {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: {
      db: Db;
      orchestrator: Orchestrator;
      providers: ProviderConfigService;
      settings: SettingsService;
      rng?: () => number;
      /** Base delay between ticks; actual delay is base ± 50%. */
      intervalMs?: number;
    },
  ) {}

  start(): void {
    const base = this.deps.intervalMs ?? 10_000;
    const rng = this.deps.rng ?? Math.random;
    const schedule = () => {
      this.timer = setTimeout(async () => {
        try {
          await this.tick();
        } catch (err) {
          console.error('[ambient] tick failed', err);
        }
        schedule();
      }, base * (0.5 + rng()));
    };
    schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Queue one canned task for a random idle mock agent. Returns the task id, if any. */
  async tick(): Promise<string | null> {
    const { db, orchestrator, providers, settings } = this.deps;
    const rng = this.deps.rng ?? Math.random;
    if (!(await settings.get()).ambient) return null;

    const mockFloors: ProviderId[] = [];
    for (const p of await providers.all()) if (p.mode === 'mock') mockFloors.push(p.id);
    if (mockFloors.length === 0) return null;

    const agents = await db.agent.findMany({
      where: { providerId: { in: mockFloors }, archivedAt: null, tasks: { none: { status: 'queued' } } },
    });
    const idle = agents.filter((a) => !orchestrator.isBusy(a.id));
    if (idle.length === 0) return null;

    const agent = idle[Math.floor(rng() * idle.length)]!;
    const prompt = AMBIENT_PROMPTS[Math.floor(rng() * AMBIENT_PROMPTS.length)]!;
    const task = await orchestrator.enqueue({ prompt, target: { agentId: agent.id } });
    return task.id;
  }
}
