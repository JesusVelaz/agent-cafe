/**
 * Seeds the café's starting crew and provider rows. Idempotent: existing agents
 * (matched by name) and provider configs are left alone.
 */
import { DEFAULTS, PROVIDER_IDS, type ProviderId } from '@agent-cafe/shared';
import type { Db } from './client.js';

interface SeedAgent {
  name: string;
  providerId: ProviderId;
  model: string;
  systemPrompt: string;
  spriteSeed: number;
}

const BASE = 'You are a helpful agent working in Agent Café. Use tools when they help. Be concise.';

export const SEED_AGENTS: SeedAgent[] = [
  // Ground floor: OpenAI
  { name: 'Mocha', providerId: 'openai', model: 'gpt-6-sol', spriteSeed: 11, systemPrompt: `${BASE} You enjoy coding tasks.` },
  { name: 'Chai', providerId: 'openai', model: 'gpt-6-luna', spriteSeed: 23, systemPrompt: `${BASE} You are fast and to the point.` },
  { name: 'Biscotti', providerId: 'openai', model: 'gpt-6-astra', spriteSeed: 37, systemPrompt: `${BASE} You research carefully.` },
  // Upstairs: Anthropic
  { name: 'Earl', providerId: 'anthropic', model: 'claude-opus-5', spriteSeed: 41, systemPrompt: `${BASE} You plan and manage.` },
  { name: 'Matcha', providerId: 'anthropic', model: 'claude-sonnet-5', spriteSeed: 53, systemPrompt: `${BASE} You write clearly.` },
  { name: 'Scone', providerId: 'anthropic', model: 'claude-haiku-4-5', spriteSeed: 67, systemPrompt: `${BASE} You keep the archive tidy.` },
];

export async function seed(db: Db): Promise<void> {
  for (const id of PROVIDER_IDS) {
    await db.providerConfig.upsert({
      where: { id },
      create: { id, mode: 'mock', dailyCapUsd: DEFAULTS.dailyCapUsd },
      update: {},
    });
  }
  for (const a of SEED_AGENTS) {
    const exists = await db.agent.findFirst({ where: { name: a.name } });
    if (!exists) await db.agent.create({ data: a });
  }
  await db.setting.upsert({
    where: { key: 'ambient' },
    create: { key: 'ambient', value: 'true' },
    update: {},
  });
}
