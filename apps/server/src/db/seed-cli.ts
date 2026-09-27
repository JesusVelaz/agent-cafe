import { createDb } from './client.js';
import { SEED_AGENTS, seed } from './seed.js';

const db = createDb();
await seed(db);
console.log(`Seeded ${SEED_AGENTS.length} agents.`);
await db.$disconnect();
