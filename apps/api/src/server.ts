/**
 * Servidor BFF — composition root do monólito modular (A01 §2, A08 §11).
 *
 * Responsabilidade: instanciar adapters concretos, injetar nas ports e
 * montar o app Hono com as rotas. O `index.ts` apenas chama `criarApp()`
 * e faz `serve()`.
 *
 * Demo local: stores em memória para Identidade/Matching (perfil, critérios, alertas).
 */

import { Hono } from 'hono';
import {
  ConsultarTriagemUseCase,
  RegistrarFeedbackTriagemUseCase,
  SolicitarTriagemUseCase,
} from '@radar/triagem';
import {
  ConsultarAlertasTenantUseCase,
  ConsultarMetricasMatchingUseCase,
  DefinirCriterioMonitoramentoUseCase,
  RegistrarFeedbackAlertaUseCase,
} from '@radar/matching';
import { ConsultarPerfilHabilitacaoUseCase, GerenciarPerfilHabilitacaoUseCase } from '@radar/identidade';
import { DefinirPreferenciasNotificacaoUseCase } from '@radar/notificacao';
import { CryptoCriterioIdProvider } from '@radar/matching/infra';
import { healthRouter } from './routes/health.js';
import { criarAlertasRouter } from './routes/alertas.js';
import { criarTriagemRouter } from './routes/triagem.js';
import { criarMatchingRouter } from './routes/matching.js';
import { criarIdentidadeRouter } from './routes/identidade.js';
import { criarNotificacaoRouter } from './routes/notificacao.js';
import { criarDemoRouter } from './routes/demo.js';
import { responderErro } from './errors.js';
import { criarLoggerHttpSeguro, redigirParaLog } from './logging.js';
import { corsMiddleware, csrfMiddleware, securityHeadersMiddleware } from './security.js';
import { PerfilAtivoConfigAdapter } from './infra/perfil-ativo-config-adapter.js';
import { triagemStub, extracaoStub } from './infra/triagem-stub.js';
import { perfilIdProviderStub } from './infra/identidade-stub.js';
import { criarPerfilMemoriaStore } from './infra/perfil-memoria-store.js';
import { criarPreferenciaMemoriaStore } from './infra/preferencia-memoria-store.js';
import {
  auditCriterioStub,
  eventPublisherStub,
  systemClock,
} from './infra/matching-stub.js';
import {
  criarAlertaMemoriaStore,
  criarCatalogoMemoriaDoLote,
  criarCriterioMemoriaStore,
  criarFaixaValorMemoria,
  criarMetricaMemoria,
} from './infra/matching-memoria-store.js';
import { rematchLoteComCriterios } from './infra/rematch-lote-demo.js';
import { listarLoteDemo } from './infra/demo-pncp-store.js';

/** Seed de tenants — obrigatório em runtime para que o endpoint responda 200. */
const tenantSeed = process.env['TENANT_SEED'] ?? '{}';
const perfilAtivo = PerfilAtivoConfigAdapter.fromJson(tenantSeed);

export function criarApp(): Hono {
  const perfilRepo = criarPerfilMemoriaStore();
  const criterioRepo = criarCriterioMemoriaStore();
  const alertaRepo = criarAlertaMemoriaStore();
  const catalogo = criarCatalogoMemoriaDoLote();
  const faixaValor = criarFaixaValorMemoria();
  const metricaRepo = criarMetricaMemoria(alertaRepo);

  const consultarTriagem = new ConsultarTriagemUseCase(triagemStub, extracaoStub);
  const solicitarTriagem = new SolicitarTriagemUseCase(
    { porId: async () => null },
    triagemStub,
    eventPublisherStub,
  );
  const registrarFeedbackTriagem = new RegistrarFeedbackTriagemUseCase(triagemStub, eventPublisherStub);
  const gerenciarPerfil = new GerenciarPerfilHabilitacaoUseCase(
    perfilRepo,
    perfilIdProviderStub,
    eventPublisherStub,
  );
  const consultarPerfil = new ConsultarPerfilHabilitacaoUseCase(perfilRepo);

  const preferenciaRepo = criarPreferenciaMemoriaStore();
  const definirPreferencias = new DefinirPreferenciasNotificacaoUseCase(preferenciaRepo);

  const definirCriterio = new DefinirCriterioMonitoramentoUseCase(
    criterioRepo,
    faixaValor,
    eventPublisherStub,
    new CryptoCriterioIdProvider(),
    systemClock,
    auditCriterioStub,
  );
  const registrarFeedbackAlerta = new RegistrarFeedbackAlertaUseCase(alertaRepo, eventPublisherStub);
  const consultarAlertas = new ConsultarAlertasTenantUseCase(alertaRepo, catalogo);
  const consultarMetricas = new ConsultarMetricasMatchingUseCase(metricaRepo);

  async function rematchTenant(tenantId: Parameters<typeof rematchLoteComCriterios>[1], signal: AbortSignal) {
    const { itens } = listarLoteDemo();
    return rematchLoteComCriterios(itens, tenantId, {
      criterios: criterioRepo,
      alertas: alertaRepo,
      catalogo,
    }, signal);
  }

  const app = new Hono();

  app.use('*', securityHeadersMiddleware);
  app.use('/api/*', corsMiddleware);
  app.use('/api/*', csrfMiddleware);
  app.use('*', criarLoggerHttpSeguro());

  app.route('/health', healthRouter);

  app.route('/api/alertas', criarAlertasRouter({ consultarAlertas }));
  app.route('/api/triagem', criarTriagemRouter({ consultarTriagem, solicitarTriagem, registrarFeedback: registrarFeedbackTriagem, perfilAtivo }));
  app.route(
    '/api/matching',
    criarMatchingRouter({
      definirCriterio,
      registrarFeedback: registrarFeedbackAlerta,
      consultarMetricas,
      perfilAtivo,
      rematchAposSalvar: rematchTenant,
    }),
  );
  app.route('/api/identidade', criarIdentidadeRouter({ gerenciarPerfil, consultarPerfil, perfilAtivo }));
  app.route('/api/notificacao', criarNotificacaoRouter({ definirPreferencias }));

  if (process.env['NODE_ENV'] !== 'production') {
    app.route(
      '/api/demo',
      criarDemoRouter({
        consultarPerfil,
        perfilAtivo,
        rematch: rematchTenant,
        tamanhoCatalogo: () => catalogo.tamanho(),
      }),
    );
  }

  app.notFound((c) => c.json({ code: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' }, 404));

  app.onError((err, c) => {
    console.error('[API] Exceção não tratada:', redigirParaLog(err));
    return responderErro(c, err);
  });

  return app;
}
