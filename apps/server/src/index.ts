import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 4318);
const app = await buildApp();
await app.listen({ host: '127.0.0.1', port });
console.log(`☕ Agent Café server on http://127.0.0.1:${port}`);
