/**
 * Publisher de evento roteado por `evento.type` → fila SQS (RAD-319, RAD-328, P-113 item 2) —
 * extraído de `workers.ts` para ser compartilhado entre os composition roots de `apps/api`
 * (`workers.ts` e `server.ts`), que publicam eventos de módulos diferentes na mesma malha de
 * filas (RAD-321). Tipo de evento sem `<NOME>_QUEUE_URL` configurada cai no fallback no-op —
 * nunca lança, só loga (item 6: nunca falha o boot por uma fila ainda não provisionada).
 */
import { SqsEventPublisher, type DomainEvent, type QueueClient } from '@radar/kernel';
import { correlationIdAtual, type Logger } from '@radar/observabilidade';

/** `<NOME>_QUEUE_URL` (RAD-321) — ausente = publish/consumo daquela fila fica no-op. */
export function resolverQueueUrl(nome: string): string | undefined {
  return process.env[`${nome}_QUEUE_URL`];
}

export interface EventPublisherRoteado {
  publicar(evento: DomainEvent, signal: AbortSignal): Promise<void>;
}

/**
 * Cada tipo de evento do módulo pode ir a uma fila SQS diferente (ex. Triagem:
 * `triagem.solicitada`/`triagem.concluida`/`triagem.falhou`, 3 filas distintas).
 */
export function criarPublisherRoteado(
  client: QueueClient,
  filasPorTipo: Record<string, string | undefined>,
  logger: Logger,
): EventPublisherRoteado {
  const porTipo = new Map<string, SqsEventPublisher>();
  for (const [tipo, queueUrl] of Object.entries(filasPorTipo)) {
    if (queueUrl) porTipo.set(tipo, new SqsEventPublisher(client, queueUrl, correlationIdAtual));
  }
  return {
    async publicar(evento, signal) {
      const publisher = porTipo.get(evento.type);
      if (!publisher) {
        logger.warn('evento.sem-fila', `${evento.type} sem QUEUE_URL configurada — publish descartado`, {
          tipoEvento: evento.type,
        });
        return;
      }
      await publisher.publicar(evento, signal);
    },
  };
}
