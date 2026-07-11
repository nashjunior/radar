import { Alerta } from '../../domain/entities/alerta.js';
import { alertaParaDTO } from '../dtos.js';
import type { AlertaDTO, EditalParaMatchingDTO } from '../dtos.js';
import type {
  AlertaIdProvider,
  CriterioRepository,
  FilaAlertaPort,
} from '../ports.js';

export interface CasarEditalInput {
  /** Snapshot normalizado do edital, vindo do payload de `edital.ingerido` (P-97). */
  edital: EditalParaMatchingDTO;
}

/**
 * Cruza um edital com todos os critérios ativos e enfileira alertas para gravação em lote.
 * Trigger: evento `edital.ingerido` (A03 §3) — nunca no caminho síncrono da API.
 * Postura recall-alto (docs/11 §2): gera alerta para toda aderência acima do limiar mínimo.
 * P-40: fan-out scan SQL no MVP; percolator no Next.
 * P-97: edital recebido diretamente do evento (PL enriquecido) — sem leitura cross-contexto do DB.
 * P-41/RAD-179: enfileira para FilaAlertaPort em vez de INSERT direto — ConsumidorAlertaBatch faz
 * o batch INSERT + publica AlertaGerado, tornando a contagem de conexão determinística.
 */
export class CasarEditalComCriteriosUseCase {
  constructor(
    private readonly criterios: CriterioRepository,
    private readonly filaAlerta: FilaAlertaPort,
    private readonly ids: AlertaIdProvider,
  ) {}

  async executar(
    input: CasarEditalInput,
    signal: AbortSignal,
  ): Promise<AlertaDTO[]> {
    const { edital } = input;
    const criteriosAtivos = await this.criterios.listarAtivos(signal);

    const alertasGerados: AlertaDTO[] = [];

    for (const criterio of criteriosAtivos) {
      const aderencia = criterio.casaCom(edital);
      if (aderencia === null || !aderencia.superaLimiar) continue;

      const alerta = Alerta.criar({
        id: this.ids.gerar(),
        tenantId: criterio.tenantId,
        clienteFinalId: criterio.clienteFinalId,
        criterioId: criterio.id,
        editalId: edital.id,
        aderencia,
      });

      await this.filaAlerta.enfileirar(
        {
          alertaId: alerta.id,
          tenantId: alerta.tenantId,
          clienteFinalId: alerta.clienteFinalId,
          criterioId: alerta.criterioId,
          editalId: alerta.editalId,
          aderencia: alerta.aderencia.valor,
        },
        signal,
      );

      alertasGerados.push(alertaParaDTO(alerta, edital.proveniencia));
    }

    return alertasGerados;
  }
}
