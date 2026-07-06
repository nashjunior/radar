import { Alerta } from '../../domain/entities/alerta.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';
import { alertaParaDTO } from '../dtos.js';
import type { AlertaDTO, EditalParaMatchingDTO } from '../dtos.js';
import { AlertaGerado } from '../events.js';
import type {
  AlertaIdProvider,
  AlertaRepository,
  CriterioRepository,
  EventPublisher,
} from '../ports.js';

export interface CasarEditalInput {
  /** Snapshot normalizado do edital, vindo do payload de `edital.ingerido` (P-97). */
  edital: EditalParaMatchingDTO;
}

/**
 * Cruza um edital com todos os critérios ativos e gera alertas.
 * Trigger: evento `edital.ingerido` (A03 §3) — nunca no caminho síncrono da API.
 * Postura recall-alto (docs/11 §2): gera alerta para todo score acima do limiar mínimo.
 * P-40: fan-out scan SQL no MVP; percolator no Next.
 * P-97: edital recebido diretamente do evento (PL enriquecido) — sem leitura cross-contexto do DB.
 */
export class CasarEditalComCriteriosUseCase {
  constructor(
    private readonly criterios: CriterioRepository,
    private readonly alertas: AlertaRepository,
    private readonly eventos: EventPublisher,
    private readonly ids: AlertaIdProvider,
  ) {}

  async executar(
    input: CasarEditalInput,
    signal: AbortSignal,
  ): Promise<AlertaDTO[]> {
    const { edital } = input;
    const casamentos = await this.criterios.casarComEdital(edital, signal);

    const alertasGerados: AlertaDTO[] = [];

    for (const { criterio, score } of casamentos) {
      const aderencia = AderenciaMatching.criar(score);

      if (!aderencia.superaLimiar) continue;

      const alerta = Alerta.criar({
        id: this.ids.gerar(),
        tenantId: criterio.tenantId,
        clienteFinalId: criterio.clienteFinalId,
        criterioId: criterio.id,
        editalId: edital.id,
        aderencia,
      });

      await this.alertas.salvar(alerta, signal);

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

      alertasGerados.push(alertaParaDTO(alerta));
    }

    return alertasGerados;
  }
}
