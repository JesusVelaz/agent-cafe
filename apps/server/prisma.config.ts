import { defineConfig } from 'prisma/config';
import { databaseUrl } from './src/paths.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: databaseUrl() },
});
