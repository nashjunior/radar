import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 300_000,  // 5 min — DB5 soak acumula iterações
    hookTimeout: 120_000,  // 2 min — container startup
    reporters: ['verbose'],
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
