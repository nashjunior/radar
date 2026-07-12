/**
 * Assinante local de `notificacao.enviada` → projeção do Matching (P-114, A18 §5.2, RAD-330).
 * Perna `coberto` (2/2) do read-model de cobertura de prazo crítico — irmã de `registrarLote`
 * (`AlertaDevidoRepository`, perna `elegivel`, RAD-329). Mesmo padrão evento→métrica do
 * RAD-302: decora o `EventPublisher` da Notificação no composition root e SEMPRE delega ao
 * publish real — nenhum use case ganha port de projeção, nenhum `executar(input, signal)` muda.
 */

import type { AlertaDevidoRepository } from '@radar/matching';
import type { NotificacaoEnviada } from '@radar/notificacao';
import type { Logger } from '@radar/observabilidade';

interface EventPublisherGenerico<E> {
  publicar(evento: E, signal: AbortSignal): Promise<void>;
}

/**
 * Decora o `EventPublisher` da Notificação: em `notificacao.enviada`, marca `notificado_em`
 * na projeção `alerta_devido` do Matching e SEMPRE delega ao publisher real — falha ao marcar
 * a projeção nunca pode impedir o publish do evento (mesma postura do assinante de métrica).
 *
 * Chaveado por `payload.alertaId`, NUNCA por `payload.alertaGeradoEm`: este é opcional e
 * ausente no caminho digest (`modules/notificacao/src/application/events.ts`, scheduler-driven,
 * sem o instante do alerta individual) — chavear por ele faria um alerta notificado via digest
 * aparecer falsamente descoberto no reconciliador (SLO de error budget zero, docs/08 §4.1).
 */
export function criarEventPublisherComCoberturaPrazoCritico<E extends { type: string }>(
  interno: EventPublisherGenerico<E>,
  alertaDevidos: AlertaDevidoRepository,
  logger: Logger,
): EventPublisherGenerico<E> {
  return {
    async publicar(evento: E, signal: AbortSignal): Promise<void> {
      if (evento.type === 'notificacao.enviada') {
        await marcarCobertura(evento as unknown as NotificacaoEnviada, alertaDevidos, logger, signal);
      }
      await interno.publicar(evento, signal);
    },
  };
}

async function marcarCobertura(
  evento: NotificacaoEnviada,
  alertaDevidos: AlertaDevidoRepository,
  logger: Logger,
  signal: AbortSignal,
): Promise<void> {
  try {
    await alertaDevidos.marcarNotificado(evento.payload.alertaId, evento.occurredAt, signal);
  } catch (erro) {
    logger.error(
      'cobertura-prazo-critico.marcar-notificado-falhou',
      'Falha ao marcar notificado_em na projeção de alertas devidos — publish do evento segue normalmente',
      { alertaId: evento.payload.alertaId, erro },
    );
  }
}
