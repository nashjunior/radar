/**
 * Servidor BFF — composition root do monólito modular (A01 §2, A08 §11).
 *
 * Responsabilidade: instanciar adapters concretos, injetar nas ports e
 * montar o app Hono com as rotas. O `index.ts` apenas chama `criarApp()`
 * e faz `serve()`.
 *
 * TODO (RAD-30/RAD-31): wiring completo dos módulos quando os adapters de
 * persistência estiverem prontos.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { healthRouter } from './routes/health.js';
import { criarTriagemRouter } from './routes/triagem.js';

export function criarApp(): Hono {
  const app = new Hono();

  app.use('*', logger());

  // Rota de saúde — sem autenticação
  app.route('/health', healthRouter);

  // API principal — tenant obrigatório
  app.route('/api/triagem', criarTriagemRouter());

  // Catch-all 404
  app.notFound((c) => c.json({ code: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' }, 404));

  // Tratamento global de exceções não capturadas
  app.onError((err, c) => {
    const isDev = process.env['NODE_ENV'] !== 'production';
    console.error('[API] Exceção não tratada:', err);
    return c.json(
      {
        code: 'ERRO_INTERNO',
        mensagem: isDev && err instanceof Error ? err.message : 'Erro interno.',
      },
      500,
    );
  });

  return app;
}
