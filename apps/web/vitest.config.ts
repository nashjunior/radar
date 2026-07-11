import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@/domain': fileURLToPath(new URL('./domain', import.meta.url)),
      '@/application': fileURLToPath(new URL('./application', import.meta.url)),
      '@/infra': fileURLToPath(new URL('./infra', import.meta.url)),
      '@/ui': fileURLToPath(new URL('./ui', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
  },
});
