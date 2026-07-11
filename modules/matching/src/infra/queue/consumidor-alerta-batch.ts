import { AlertaId, ClienteFinalId, CriterioId, EditalId, TenantId } from '@radar/kernel';
import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { AlertaGerado } from '../../application/events.js';
import type { AlertaRepository, EventPublisher, FilaAlertaPort } from '../../application/ports.js';

/**
 * Consumidor bounded de alertas — drena FilaAlertaPort em lotes e faz batch INSERT (P-41/RAD-179).
 * Cada chamada a `processarLote` usa UMA conexão de banco para N linhas (vs. N conexões antes).
 * Publica AlertaGerado APÓS o INSERT — garante que Notificação encontra o alerta no DB.
 * Pool fixo: operador externo (Lambda, cron, worker) limita concorrência — não responsabilidade desta classe.
 */
export class ConsumidorAlertaBatch {
  static readonly TAMANHO_LOTE_PADRAO = 100;

  constructor(
    private readonly fila: FilaAlertaPort,
    private readonly alertas: AlertaRepository,
    private readonly eventos: EventPublisher,
  ) {}

  /**
   * Drena até `tamanhoDeLote` alertas da fila, persiste em batch e publica eventos.
   * Retorna o número de alertas processados (0 quando fila vazia).
   */
  async processarLote(
    signal: AbortSignal,
    tamanhoDeLote = ConsumidorAlertaBatch.TAMANHO_LOTE_PADRAO,
  ): Promise<number> {
    const payloads = await this.fila.drenar(tamanhoDeLote, signal);
    if (payloads.length === 0) return 0;

    const entidades = payloads.map((p) =>
      Alerta.reconstituir({
        id: AlertaId(p.alertaId),
        tenantId: TenantId(p.tenantId),
        clienteFinalId: ClienteFinalId(p.clienteFinalId),
        criterioId: CriterioId(p.criterioId),
        editalId: EditalId(p.editalId),
        aderencia: AderenciaMatching.criar(p.aderencia),
        relevante: null,
      }),
    );

    await this.alertas.salvarEmLote(entidades, signal);

    for (const alerta of entidades) {
      await this.eventos.publicar(
        new AlertaGerado({
          alertaId: alerta.id,
          tenantId: alerta.tenantId,
          clienteFinalId: alerta.clienteFinalId,
          criterioId: alerta.criterioId,
          editalId: alerta.editalId,
          aderencia: alerta.aderencia.valor,
        }),
        signal,
      );
    }

    return entidades.length;
  }
}
