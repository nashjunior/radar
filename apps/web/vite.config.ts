import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { obterDevAuthTokenSeguro } from './infra/auth/auth-env';

/**
 * SPA agnóstica — **sem lock-in de vendor** (arquitetura/12, §1). Sem Next.js.
 * Build estático em `dist/`, hospedável em qualquer CDN (arquitetura/08).
 * Os aliases espelham os da tsconfig.json (Clean Arch: domain/application/infra/ui).
 *
 * Dev: proxy /api → apps/api (porta VITE_API_URL, default :3000).
 * Prod: SPA servida do mesmo domínio que a API (container atrás do gateway/WAF — A08).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env['VITE_API_URL'] ?? 'http://localhost:3000';
  obterDevAuthTokenSeguro({ MODE: mode, VITE_DEV_AUTH_TOKEN: env['VITE_DEV_AUTH_TOKEN'] });

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@/domain': fileURLToPath(new URL('./domain', import.meta.url)),
        '@/application': fileURLToPath(new URL('./application', import.meta.url)),
        '@/infra': fileURLToPath(new URL('./infra', import.meta.url)),
        '@/ui': fileURLToPath(new URL('./ui', import.meta.url)),
      },
    },
    server: {
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
  };
});
