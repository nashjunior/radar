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
import {
  AutorizarAcessoUseCase,
  ConsultarPerfilHabilitacaoUseCase,
  GerenciarPerfilHabilitacaoUseCase,
  ResolverContextoAutorizacaoUseCase,
} from '@radar/identidade';
import { DefinirPreferenciasNotificacaoUseCase } from '@radar/notificacao';
import { CryptoCriterioIdProvider } from '@radar/matching/infra';
import { healthRouter } from './routes/health.js';
import { criarAlertasRouter } from './routes/alertas.js';
import { criarTriagemRouter } from './routes/triagem.js';
import { criarMatchingRouter } from './routes/matching.js';
import { criarIdentidadeRouter } from './routes/identidade.js';
import { criarNotificacaoRouter } from './routes/notificacao.js';
import { criarMeRouter } from './routes/me.js';
import { responderErro } from './errors.js';
import { criarLoggerHttpSeguro, redigirParaLog } from './logging.js';
import { corsMiddleware, csrfMiddleware, securityHeadersMiddleware } from './security.js';
import { criarAutorizarMiddlewareFactory } from './middleware/autorizacao.js';
import { PerfilAtivoConfigAdapter } from './infra/perfil-ativo-config-adapter.js';
import { PermissaoConfigAdapter } from './infra/permissao-config-adapter.js';
import { triagemStub, extracaoStub } from './infra/triagem-stub.js';
import { perfilRepositoryStub, perfilIdProviderStub } from './infra/identidade-stub.js';
import { preferenciaStub } from './infra/notificacao-stub.js';
import {
  criterioStub,
  alertaStub,
  auditCriterioStub,
  editalCatalogoStub,
  faixaValorStub,
  eventPublisherStub,
  metricaStub,
  systemClock,
} from './infra/matching-stub.js';

/** Seed de tenants — obrigatório em runtime para que o endpoint responda 200. */
const tenantSeed = process.env['TENANT_SEED'] ?? '{}';
const perfilAtivo = PerfilAtivoConfigAdapter.fromJson(tenantSeed);

/** Seed de atribuição de papel (P-52) — obrigatório em runtime para que RBAC autorize alguém. */
const permissaoSeed = process.env['PERMISSAO_SEED'] ?? '{}';
const permissaoRepository = PermissaoConfigAdapter.fromJson(permissaoSeed);

export function criarApp(): Hono {
  const consultarTriagem = new ConsultarTriagemUseCase(triagemStub, extracaoStub);
  const solicitarTriagem = new SolicitarTriagemUseCase(
    { porId: async () => null },  // PerfilGateway stub — retorna null (AcessoNegadoError) até Postgres
    triagemStub,
    eventPublisherStub,
  );
  const registrarFeedbackTriagem = new RegistrarFeedbackTriagemUseCase(triagemStub, eventPublisherStub);
  const gerenciarPerfil = new GerenciarPerfilHabilitacaoUseCase(
    perfilRepositoryStub,
    perfilIdProviderStub,
    eventPublisherStub,
  );
  const consultarPerfil = new ConsultarPerfilHabilitacaoUseCase(perfilRepositoryStub);

  const definirPreferencias = new DefinirPreferenciasNotificacaoUseCase(preferenciaStub);

  const definirCriterio = new DefinirCriterioMonitoramentoUseCase(
    criterioStub,
    faixaValorStub,
    eventPublisherStub,
    new CryptoCriterioIdProvider(),
    systemClock,
    auditCriterioStub,
  );
  const registrarFeedbackAlerta = new RegistrarFeedbackAlertaUseCase(alertaStub, eventPublisherStub);
  const consultarAlertas = new ConsultarAlertasTenantUseCase(alertaStub, editalCatalogoStub);
  const consultarMetricas = new ConsultarMetricasMatchingUseCase(metricaStub);

  const resolverContexto = new ResolverContextoAutorizacaoUseCase(permissaoRepository);
  const autorizarAcesso = new AutorizarAcessoUseCase();
  const autorizar = criarAutorizarMiddlewareFactory({ resolverContexto, autorizarAcesso });

  const app = new Hono();

  app.use('*', securityHeadersMiddleware);
  app.use('/api/*', corsMiddleware);
  app.use('/api/*', csrfMiddleware);
  app.use('*', criarLoggerHttpSeguro());

  // Rota de saúde — sem autenticação
  app.route('/health', healthRouter);

  // API principal — tenant obrigatório
  app.route('/api/me', criarMeRouter({ resolverContexto }));
  app.route('/api/alertas', criarAlertasRouter({ consultarAlertas, autorizar }));
  app.route('/api/triagem', criarTriagemRouter({ consultarTriagem, solicitarTriagem, registrarFeedback: registrarFeedbackTriagem, perfilAtivo, autorizar }));
  app.route('/api/matching', criarMatchingRouter({ definirCriterio, registrarFeedback: registrarFeedbackAlerta, consultarMetricas, perfilAtivo, autorizar }));
  app.route('/api/identidade', criarIdentidadeRouter({ gerenciarPerfil, consultarPerfil, perfilAtivo, autorizar }));
  app.route('/api/notificacao', criarNotificacaoRouter({ definirPreferencias, autorizar }));

  // Catch-all 404
  app.notFound((c) => c.json({ code: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' }, 404));

  // Tratamento global de exceções não capturadas
  app.onError((err, c) => {
    console.error('[API] Exceção não tratada:', redigirParaLog(err));
    return responderErro(c, err);
  });

  return app;
}
