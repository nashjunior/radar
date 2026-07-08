import type { TenantId } from '@radar/kernel';
import { RegistroAuditoria } from '../../domain/entities/registro-auditoria.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import type {
  AcaoRetencao,
  AuditLogIdProvider,
  AuditLogRepository,
  CandidatoExpurgo,
  Clock,
  ExpurgoCandidatoRepository,
  ExpurgoPort,
  PoliticaRetencao,
  ResultadoExpurgo,
  RetencaoDTO,
} from '../ports.js';

export interface AplicarRetencaoInput {
  readonly politica: PoliticaRetencao;
  readonly tenantId: TenantId;
  /** Identificador do operador (sistema/job) para trilha de auditoria — sem PII livre. */
  readonly operadorId: string;
  /**
   * Modo simulação (dry-run): lista elegíveis e calcula o relatório sem executar
   * nenhum expurgo nem gravar auditoria. Seguro para inspecionar antes de aplicar.
   */
  readonly modoSimulacao?: boolean;
}

/**
 * Aplica a política de retenção de dados contra os candidatos elegíveis (P-05/P-44/RAD-101).
 *
 * Invariantes:
 * - Prazos nunca são hard-coded: vêm da PoliticaRetencao injetada.
 * - AUDIT_LOG nunca é eliminado por esta operação (P-61/AB13).
 * - Cada expurgo gera auditoria append-only; se auditoria falhar, operação para (fail-closed).
 * - Idempotente: se item já foi expurgado na infra, listarElegiveis não o retorna.
 * - Abortável via AbortSignal: interrompe entre candidatos sem estado parcial ilegível.
 * - Não vaza PII em logs ou relatório — itemId é opaco (hash/UUID gerido pela infra).
 */
export class AplicarRetencaoUseCase {
  constructor(
    private readonly candidatos: ExpurgoCandidatoRepository,
    private readonly expurgo: ExpurgoPort,
    private readonly auditLog: AuditLogRepository,
    private readonly idProvider: AuditLogIdProvider,
    private readonly clock: Clock,
  ) {}

  async executar(input: AplicarRetencaoInput, signal: AbortSignal): Promise<RetencaoDTO> {
    const resultados: ResultadoExpurgo[] = [];
    let totalListados = 0;

    for (const config of input.politica.conjuntos) {
      if (signal.aborted) break;

      // INVARIANTE: AUDIT_LOG append-only nunca é eliminado por retenção automática (P-61/AB13).
      // Anonimização de AUDIT_LOG segue processo controlado fora deste use case.
      if (config.conjunto === 'AUDIT_LOG' && config.acao === 'ELIMINAR') {
        continue;
      }

      // PRESERVAR significa "nenhuma ação de expurgo no momento" — skip silencioso.
      if (config.acao === 'PRESERVAR') {
        continue;
      }

      const elegiveis = await this.candidatos.listarElegiveis(
        config.conjunto,
        input.tenantId,
        signal,
      );
      totalListados += elegiveis.length;

      for (const candidato of elegiveis) {
        if (signal.aborted) break;

        if (candidato.excecao != null) {
          resultados.push({
            itemId: candidato.itemId,
            conjunto: candidato.conjunto,
            acao: 'RETIDO_POR_EXCECAO',
            excecao: candidato.excecao,
          });
          continue;
        }

        if (!input.modoSimulacao) {
          await this.aplicarAcao(config.acao, candidato, signal);
          await this.registrarAuditoria(config.acao, candidato, input, signal);
        }

        resultados.push({
          itemId: candidato.itemId,
          conjunto: candidato.conjunto,
          acao: config.acao,
        });
      }
    }

    const aplicados = resultados.filter((r) => r.acao !== 'RETIDO_POR_EXCECAO').length;
    const retidosPorExcecao = resultados.length - aplicados;

    return {
      politicaVersao: input.politica.versao,
      elegiveis: totalListados,
      aplicados,
      retidosPorExcecao,
      resultados,
    };
  }

  private async aplicarAcao(
    acao: AcaoRetencao,
    candidato: CandidatoExpurgo,
    signal: AbortSignal,
  ): Promise<void> {
    if (acao === 'ELIMINAR') {
      await this.expurgo.eliminar(candidato.conjunto, candidato.itemId, signal);
    } else {
      await this.expurgo.anonimizar(candidato.conjunto, candidato.itemId, signal);
    }
  }

  private async registrarAuditoria(
    acao: AcaoRetencao,
    candidato: CandidatoExpurgo,
    input: AplicarRetencaoInput,
    signal: AbortSignal,
  ): Promise<void> {
    const registro = RegistroAuditoria.criar({
      id: this.idProvider.gerar(),
      usuarioId: input.operadorId,
      recurso: `retencao:${candidato.conjunto}:${candidato.itemId}`,
      acao,
      baseLegal: 'LGPD art. 15-16 término do tratamento',
      escopo: { tenantId: input.tenantId },
      ocorridoEm: this.clock.agora(),
    });

    try {
      await this.auditLog.registrar(registro, signal);
    } catch {
      // Fail-closed: auditoria indisponível para o expurgo — interrompe (AB13/P-61).
      throw new AuditoriaIndisponivelError();
    }
  }
}
