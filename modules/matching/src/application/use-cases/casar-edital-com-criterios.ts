import { Alerta } from '../../domain/entities/alerta.js';
import { PrazoCritico } from '../../domain/value-objects/prazo-critico.js';
import { alertaParaDTO } from '../dtos.js';
import type { AlertaDTO, EditalParaMatchingDTO } from '../dtos.js';
import type {
  AlertaDevidoRepository,
  AlertaIdProvider,
  ClockProvider,
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
 * P-114/A18 §5.2: grava a projeção de alertas devidos ANTES de enfileirar (não pela fila) —
 * se o enfileiramento falhar depois, a linha do devido já existe, que é o caso que o
 * reconciliador de prazo crítico precisa ver virar `perdido`.
 */
export class CasarEditalComCriteriosUseCase {
  constructor(
    private readonly criterios: CriterioRepository,
    private readonly filaAlerta: FilaAlertaPort,
    private readonly ids: AlertaIdProvider,
    private readonly clock: ClockProvider,
    private readonly alertaDevidos: AlertaDevidoRepository,
  ) {}

  async executar(
    input: CasarEditalInput,
    signal: AbortSignal,
  ): Promise<AlertaDTO[]> {
    const { edital } = input;
    const criteriosAtivos = await this.criterios.listarAtivos(signal);
    const agora = this.clock.agora();
    const prazoProposta = edital.prazoProposta;
    const prazoCritico = PrazoCritico.calcular(prazoProposta, agora);

    const casamentos: Alerta[] = [];
    for (const criterio of criteriosAtivos) {
      const aderencia = criterio.casaCom(edital);
      if (aderencia === null || !aderencia.superaLimiar) continue;

      casamentos.push(
        Alerta.criar({
          id: this.ids.gerar(),
          tenantId: criterio.tenantId,
          clienteFinalId: criterio.clienteFinalId,
          criterioId: criterio.id,
          editalId: edital.id,
          aderencia,
          prazoCritico,
        }),
      );
    }

    // Grava para todo casamento com prazoProposta conhecido — não só quando já crítico
    // no instante do casamento (a janela é avaliada na reconciliação, A18 §5.2 invariante 2).
    if (prazoProposta !== null && casamentos.length > 0) {
      await this.alertaDevidos.registrarLote(
        casamentos.map(alerta => ({
          alertaId: alerta.id,
          editalId: alerta.editalId,
          criterioId: alerta.criterioId,
          tenantId: alerta.tenantId,
          prazoProposta,
        })),
        signal,
      );
    }

    const alertasGerados: AlertaDTO[] = [];
    for (const alerta of casamentos) {
      await this.filaAlerta.enfileirar(
        {
          alertaId: alerta.id,
          tenantId: alerta.tenantId,
          clienteFinalId: alerta.clienteFinalId,
          criterioId: alerta.criterioId,
          editalId: alerta.editalId,
          aderencia: alerta.aderencia.valor,
          editalPublicadoEm: edital.dataPublicacao,
          prazoCritico: alerta.prazoCritico.critico,
        },
        signal,
      );

      alertasGerados.push(alertaParaDTO(alerta, edital.proveniencia));
    }

    return alertasGerados;
  }
}
