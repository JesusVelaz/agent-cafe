import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['./src/test/globalSetup.ts'],
    testTimeout: 15_000,
  },
});
