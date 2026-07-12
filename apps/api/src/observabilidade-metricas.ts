/**
 * Assinante evento → métrica (A18 §5, RAD-302 story 2/5). Traduz os eventos de domínio já
 * publicados pelos módulos em métricas CloudWatch EMF — nenhum use case ganha port de métrica,
 * nenhum `executar(input, signal)` muda. `@radar/observabilidade` fica genérico (não conhece
 * nenhum bounded context); o mapeamento evento→métrica mora aqui, no composition root, que já
 * depende de todos os módulos.
 *
 * Como não existe hoje um barramento em memória de produção nem uma fila única de onde "assinar"
 * (cada módulo publica no seu próprio `EventPublisher`), a assinatura é feita decorando o
 * `EventPublisher` de cada módulo no ponto de composição: `criarEventPublisherComMetricas` emite
 * a métrica e delega ao publisher real — o mesmo call site de `publicar(evento, signal)` que já
 * existe, sem inventar um consumidor de fila novo.
 */

import type { AlertaGerado, AlertaPrazoCriticoReconciliado } from '@radar/matching';
import type { NotificacaoEnviada } from '@radar/notificacao';
import type { TriagemConcluida } from '@radar/triagem';
import type { PipelineBreakerEstadoMudou, PipelineCicloConcluido } from '@radar/ingestao';
import { emitirMetricaEmf } from '@radar/observabilidade';

interface EventPublisherGenerico<E> {
  publicar(evento: E, signal: AbortSignal): Promise<void>;
}

type EventoComMetrica =
  | AlertaGerado
  | NotificacaoEnviada
  | TriagemConcluida
  | PipelineCicloConcluido
  | PipelineBreakerEstadoMudou
  | AlertaPrazoCriticoReconciliado;

/**
 * Decora um `EventPublisher` de qualquer módulo: emite a métrica de SLO correspondente (se
 * houver) e SEMPRE delega ao publisher real — falha ao emitir a métrica nunca impede o publish.
 * Eventos sem tradução (a maioria) passam direto, sem custo além do `switch`.
 */
export function criarEventPublisherComMetricas<E extends { type: string }>(
  interno: EventPublisherGenerico<E>,
  ambiente: string,
): EventPublisherGenerico<E> {
  return {
    async publicar(evento: E, signal: AbortSignal): Promise<void> {
      emitirMetricasDoEvento(evento as unknown as EventoComMetrica, ambiente);
      await interno.publicar(evento, signal);
    },
  };
}

function emitirMetricasDoEvento(evento: EventoComMetrica, ambiente: string): void {
  switch (evento.type) {
    case 'alerta.gerado':
      return metricaDeAlertaGerado(evento, ambiente);
    case 'notificacao.enviada':
      return metricaDeNotificacaoEnviada(evento, ambiente);
    case 'triagem.concluida':
      return metricaDeTriagemConcluida(evento, ambiente);
    case 'pipeline.ciclo.concluido':
      return metricaDePipelineCicloConcluido(evento, ambiente);
    case 'pipeline.breaker.estado-mudou':
      return metricaDePipelineBreakerEstadoMudou(evento, ambiente);
    case 'alerta.prazo-critico.reconciliado':
      return metricaDeAlertaPrazoCriticoReconciliado(evento, ambiente);
    default:
      return; // evento sem métrica de SLO associada (A18 §5) — no-op
  }
}

/** SLO "frescor do alerta" (docs/08 §4.1) — p95 publicação PNCP → alerta.gerado. */
export function metricaDeAlertaGerado(evento: AlertaGerado, ambiente: string): void {
  const frescorMs = evento.occurredAt.getTime() - evento.payload.editalPublicadoEm.getTime();
  emitirMetricaEmf({
    ambiente,
    metricas: [{ nome: 'alerta.frescor_ms', valor: frescorMs, unidade: 'Milliseconds' }],
    campos: { tenantId: evento.payload.tenantId },
  });
}

/**
 * SLO "entrega imediata" (docs/08 §4.1) — p95 alerta.gerado → notificacao.enviada, dim `imediato`.
 * O digest não carrega `alertaGeradoEm` (A18 §5 — sem leitura cross-contexto, débito RAD-91):
 * sem o instante de origem não há como medir a latência, então o digest não emite esta métrica.
 */
export function metricaDeNotificacaoEnviada(evento: NotificacaoEnviada, ambiente: string): void {
  const { alertaGeradoEm, tenantId } = evento.payload;
  if (!alertaGeradoEm) return;
  const latenciaMs = evento.occurredAt.getTime() - alertaGeradoEm.getTime();
  emitirMetricaEmf({
    ambiente,
    metricas: [{ nome: 'notificacao.latencia_entrega_ms', valor: latenciaMs, unidade: 'Milliseconds' }],
    dimensoes: { imediato: 'true' },
    campos: { tenantId },
  });
}

/**
 * SLO "triagem" (docs/08 §4.1) — p95 triagem.solicitada → triagem.concluida. `solicitadaEm` é
 * aditivo/opcional (A18 §5); sem ele, o assinante não tem o instante de origem para medir.
 */
export function metricaDeTriagemConcluida(evento: TriagemConcluida, ambiente: string): void {
  const { solicitadaEm, tenantId } = evento.payload;
  if (!solicitadaEm) return;
  const latenciaMs = evento.occurredAt.getTime() - solicitadaEm.getTime();
  emitirMetricaEmf({
    ambiente,
    metricas: [{ nome: 'triagem.latencia_ms', valor: latenciaMs, unidade: 'Milliseconds' }],
    campos: { tenantId },
  });
}

/**
 * SLO "caminho crítico ingestão → alerta" (docs/08 §4.1), metade 1/2 — disponibilidade =
 * ok / (ok + erro + api.5xx) no dashboard de RAD-304. Um ciclo com erros OU com o breaker
 * aberto não conta como saudável, mesmo que `erros` isoladamente seja 0.
 */
export function metricaDePipelineCicloConcluido(evento: PipelineCicloConcluido, ambiente: string): void {
  const ok = evento.payload.erros === 0 && !evento.payload.breakerAberto;
  emitirMetricaEmf({
    ambiente,
    metricas: [{ nome: ok ? 'pipeline.ciclo.ok' : 'pipeline.ciclo.erro', valor: 1, unidade: 'Count' }],
  });
}

/** SLO "caminho crítico ingestão → alerta" (docs/08 §4.1), metade 2/2 — saúde do circuit breaker. */
export function metricaDePipelineBreakerEstadoMudou(evento: PipelineBreakerEstadoMudou, ambiente: string): void {
  emitirMetricaEmf({
    ambiente,
    metricas: [{ nome: 'pipeline.breaker.aberto', valor: evento.payload.estadoAtual === 'ABERTO' ? 1 : 0, unidade: 'Count' }],
  });
}

/**
 * Falha de CICLO de um scheduler periódico (`iniciarAgendadorAbortavel`, kernel) — chamar do
 * `aoFalhar` de cada composition root (RAD-332, achado do guardiao-observabilidade na RAD-331).
 * Sem isto, um ciclo que lança antes de publicar seu evento de sucesso (ex.: `cobertura.contar`
 * quebrando no Postgres) não deixa nenhum rastro medível — só log, e nenhum alarme (Radar/SLO,
 * A18 §5) enxerga. `contexto` vira o prefixo do nome (um por scheduler: `alerta.prazo_critico`,
 * `pipeline`, `notificacao.digest`) sob o segmento `.ciclo.falhou` — mesma hierarquia de
 * `pipeline.ciclo.ok`/`pipeline.ciclo.erro`, não um nome solto. `erro` vai só como `campos` do
 * log (passa por `redigirParaLog`: `{ tipo, code? }`, nunca message/stack) — nunca dimensão
 * CloudWatch, pra não multiplicar combinação de dimensão por scheduler.
 */
export function metricaDeCicloFalhou(contexto: string, ambiente: string, erro?: unknown): void {
  emitirMetricaEmf({
    ambiente,
    metricas: [{ nome: `${contexto}.ciclo.falhou`, valor: 1, unidade: 'Count' }],
    ...(erro === undefined ? {} : { campos: { erro } }),
  });
}

/**
 * SLO "alerta de prazo crítico" (docs/08 §4.1) — error budget ZERO. `perdido` é o déficit
 * (`elegivel − coberto`) já calculado pelo reconciliador (A18 §5.1(3)/§5.2, P-114); o assinante
 * só traduz para EMF. Sem dimensão `tenantId` (o evento é agregado global do ciclo, não teria
 * o que segmentar de qualquer forma). Nomes fixados em A18 §5.
 */
export function metricaDeAlertaPrazoCriticoReconciliado(
  evento: AlertaPrazoCriticoReconciliado,
  ambiente: string,
): void {
  const { elegivel, coberto, perdido } = evento.payload;
  emitirMetricaEmf({
    ambiente,
    metricas: [
      { nome: 'alerta.prazo_critico.elegivel', valor: elegivel, unidade: 'Count' },
      { nome: 'alerta.prazo_critico.coberto', valor: coberto, unidade: 'Count' },
      { nome: 'alerta.prazo_critico.perdido', valor: perdido, unidade: 'Count' },
    ],
  });
}
