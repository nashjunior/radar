import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@radar/governanca': `${root}/modules/governanca/src/index.ts`,
      '@radar/identidade': `${root}/modules/identidade/src/index.ts`,
      '@radar/ingestao': `${root}/modules/ingestao/src/index.ts`,
      '@radar/kernel': `${root}/shared/kernel/ts/src/index.ts`,
      '@radar/matching': `${root}/modules/matching/src/index.ts`,
      '@radar/notificacao': `${root}/modules/notificacao/src/index.ts`,
      '@radar/triagem': `${root}/modules/triagem/src/index.ts`,
    },
  },
  test: {
    environment: 'node',
    reporters: ['verbose'],
  },
});
