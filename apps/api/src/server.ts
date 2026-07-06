/**
 * Servidor BFF — composition root do monólito modular (A01 §2, A08 §11).
 *
 * Responsabilidade: instanciar adapters concretos, injetar nas ports e
 * montar o app Hono com as rotas. O `index.ts` apenas chama `criarApp()`
 * e faz `serve()`.
 *
 * Adapters de persistência (Postgres) entram quando o infra for provisionado;
 * os stubs abaixo são substituídos aqui sem alterar o use case nem a rota.
 */

import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { ConsultarTriagemUseCase } from '@radar/triagem';
import {
  DefinirCriterioMonitoramentoUseCase,
  RegistrarFeedbackAlertaUseCase,
} from '@radar/matching';
import { CryptoCriterioIdProvider, CryptoAlertaIdProvider } from '@radar/matching/infra';
import { healthRouter } from './routes/health.js';
import { criarTriagemRouter } from './routes/triagem.js';
import { criarMatchingRouter } from './routes/matching.js';
import { PerfilAtivoConfigAdapter } from './infra/perfil-ativo-config-adapter.js';
import { triagemStub, extracaoStub } from './infra/triagem-stub.js';
import {
  criterioStub,
  alertaStub,
  faixaValorStub,
  eventPublisherStub,
  systemClock,
} from './infra/matching-stub.js';

/** Seed de tenants — obrigatório em runtime para que o endpoint responda 200. */
const tenantSeed = process.env['TENANT_SEED'] ?? '{}';
const perfilAtivo = PerfilAtivoConfigAdapter.fromJson(tenantSeed);

export function criarApp(): Hono {
  const consultarTriagem = new ConsultarTriagemUseCase(triagemStub, extracaoStub);

  const definirCriterio = new DefinirCriterioMonitoramentoUseCase(
    criterioStub,
    faixaValorStub,
    eventPublisherStub,
    new CryptoCriterioIdProvider(),
    systemClock,
  );
  const registrarFeedback = new RegistrarFeedbackAlertaUseCase(alertaStub, eventPublisherStub);

  const app = new Hono();

  app.use('*', logger());

  // Rota de saúde — sem autenticação
  app.route('/health', healthRouter);

  // API principal — tenant obrigatório
  app.route('/api/triagem', criarTriagemRouter({ consultarTriagem, perfilAtivo }));
  app.route('/api/matching', criarMatchingRouter({ definirCriterio, registrarFeedback, perfilAtivo }));

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
