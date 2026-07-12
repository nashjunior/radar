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
  ConsultarAssinaturaUseCase,
  IniciarCheckoutUseCase,
  LiberarReservaUseCase,
  ProcessarEventoDePagamentoUseCase,
  ReservarCotaUseCase,
} from '@radar/cobranca';
import { FakePagamentoGateway, WebhookPagamentoWorker } from '@radar/cobranca/infra';
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
import { criarAssinaturaRouter, criarCheckoutRouter } from './routes/cobranca.js';
import { criarWebhookPagamentoRouter } from './routes/webhooks/pagamento.js';
import { responderErro } from './errors.js';
import { criarLoggerHttpSeguro, redigirParaLog } from './logging.js';
import { corsMiddleware, csrfMiddleware, securityHeadersMiddleware } from './security.js';
import { criarAutorizarMiddlewareFactory } from './middleware/autorizacao.js';
import { criarEntitlementMiddleware } from './middleware/entitlement.js';
import { PerfilAtivoConfigAdapter } from './infra/perfil-ativo-config-adapter.js';
import { PermissaoConfigAdapter } from './infra/permissao-config-adapter.js';
import { assinaturaStub } from './infra/cobranca-stub.js';
import { PlanoComercialConfigAdapter } from './infra/plano-comercial-config-adapter.js';
import { systemClock } from './infra/system-clock.js';
import { auditoriaWebhookStub, InMemoriaFilaDeWebhookPagamento, webhookEventoStub } from './infra/cobranca-webhook-stub.js';
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
} from './infra/matching-stub.js';

/** Seed de tenants — obrigatório em runtime para que o endpoint responda 200. */
const tenantSeed = process.env['TENANT_SEED'] ?? '{}';
const perfilAtivo = PerfilAtivoConfigAdapter.fromJson(tenantSeed);

/** Seed de atribuição de papel (P-52) — obrigatório em runtime para que RBAC autorize alguém. */
const permissaoSeed = process.env['PERMISSAO_SEED'] ?? '{}';
const permissaoRepository = PermissaoConfigAdapter.fromJson(permissaoSeed);

/** Catálogo de planos comerciais (RAD-264) — preços `[A VALIDAR]` (docs/09 §6.1, P-107 (a)/(b)), nunca hardcoded. */
const planosComerciaisSeed = process.env['PLANOS_COMERCIAIS_SEED'] ?? '{}';
const planoComercialCatalogo = PlanoComercialConfigAdapter.fromJson(planosComerciaisSeed);

/**
 * Segredos do webhook Asaas (Secrets Manager com rotação, P-08 — injetados como env
 * var pela task definition, mesmo padrão de `AUTH_DEV_SECRET`/`ASAAS_API_KEY`).
 * String vazia em ambos faz `tokenWebhookAsaasValido` recusar SEMPRE — fail-closed
 * por padrão, sem abortar o boot do processo por uma rota que ainda não é crítica
 * no MVP-Now.
 *
 * `ASAAS_WEBHOOK_TOKEN_ANTERIOR` é TRANSITÓRIA (RAD-261): só existe durante a janela
 * de rotação do token — o valor anterior continua sendo aceito até o runbook de
 * rotação (`infra/terraform/modules/secrets/README.md`) removê-la. Vazia por padrão,
 * sem afrouxar a checagem do token vigente.
 */
const asaasWebhookToken = process.env['ASAAS_WEBHOOK_TOKEN'] ?? '';
const asaasWebhookTokenAnterior = process.env['ASAAS_WEBHOOK_TOKEN_ANTERIOR'] ?? '';

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

  const reservarCota = new ReservarCotaUseCase(assinaturaStub, systemClock);
  const liberarReserva = new LiberarReservaUseCase(assinaturaStub);
  const entitlement = criarEntitlementMiddleware({ reservarCota, liberarReserva });

  const consultarAssinatura = new ConsultarAssinaturaUseCase(assinaturaStub, systemClock);

  // PagamentoGateway real (AsaasPagamentoGateway) entra quando ASAAS_API_KEY/Secrets
  // Manager forem provisionados — FakePagamentoGateway mantém a confirmação outbound
  // (P-107 (5)) exercitável em dev/demo sem depender do Asaas real estar de pé.
  // Instância única compartilhada entre checkout e webhook: o mesmo `assinaturaExternaId`
  // aberto por IniciarCheckoutUseCase precisa existir no fake quando o webhook processar.
  const pagamentoGateway = new FakePagamentoGateway();
  const iniciarCheckout = new IniciarCheckoutUseCase(planoComercialCatalogo, pagamentoGateway);
  const processarEventoDePagamento = new ProcessarEventoDePagamentoUseCase(
    assinaturaStub,
    webhookEventoStub,
    pagamentoGateway,
    auditoriaWebhookStub,
  );
  // Compensação "processamento assíncrono" (aceite RAD-253, P-107 (5)) — a rota só
  // enfileira; quem chama o use case (gateway outbound + mutação) é este worker,
  // desacoplado do ciclo HTTP do webhook. Sem SQS provisionado (P-27), a fila stub
  // despacha via microtask (`InMemoriaFilaDeWebhookPagamento`).
  const webhookPagamentoWorker = new WebhookPagamentoWorker(processarEventoDePagamento);
  const filaDeWebhookPagamento = new InMemoriaFilaDeWebhookPagamento(webhookPagamentoWorker);

  const app = new Hono();

  app.use('*', securityHeadersMiddleware);
  app.use('/api/*', corsMiddleware);
  app.use('/api/*', csrfMiddleware);
  app.use('*', criarLoggerHttpSeguro());

  // Rota de saúde — sem autenticação
  app.route('/health', healthRouter);

  // Webhook do gateway de pagamento — server-to-server, FORA de /api/* de propósito
  // (RAD-250): não leva autenticarMiddleware/csrfMiddleware, tem autenticação própria.
  app.route('/webhooks/pagamento', criarWebhookPagamentoRouter({
    fila: filaDeWebhookPagamento,
    tokensEsperados: [asaasWebhookToken, asaasWebhookTokenAnterior],
  }));

  // API principal — tenant obrigatório
  app.route('/api/me', criarMeRouter({ resolverContexto }));
  app.route('/api/me/assinatura', criarAssinaturaRouter({ consultarAssinatura }));
  app.route('/api/checkout', criarCheckoutRouter({ iniciarCheckout }));
  app.route('/api/alertas', criarAlertasRouter({ consultarAlertas, autorizar }));
  app.route('/api/triagem', criarTriagemRouter({ consultarTriagem, solicitarTriagem, registrarFeedback: registrarFeedbackTriagem, perfilAtivo, autorizar, entitlement }));
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
