import type { ClienteFinalId, TenantId } from '@radar/kernel';
import {
  CriterioDeMonitoramento,
} from '../../domain/entities/criterio-de-monitoramento.js';
import { CriterioInvalidoError } from '../../domain/errors/index.js';
import { FaixaValor } from '../../domain/value-objects/faixa-valor.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { criterioParaDTO } from '../dtos.js';
import type { CriterioDTO } from '../dtos.js';
import { CriterioDefinido } from '../events.js';
import { AuditoriaCriterioService } from '../services/auditoria-criterio-service.js';
import type {
  AuditCriterioPort,
  ClockProvider,
  CriterioIdProvider,
  CriterioRepository,
  EventPublisher,
  FaixaValorReferencia,
} from '../ports.js';

export interface DefinirCriterioInput {
  /** tenantId fornecido pelo contexto de autenticação (MVP: 'global' — P-25). */
  tenantId: TenantId;
  clienteFinalId: ClienteFinalId;
  ramoCnae?: string;
  regiaoUf?: string;
  /** Chave da tabela de referência — não um valor fixo (docs/02 §2). */
  faixaValorCodigo?: string;
  palavrasChave?: string[];
}

/**
 * Define um novo critério de monitoramento para o clienteFinal.
 * Trigger: usuário via API.
 * Faixa de valor lida da tabela parametrizável datada, nunca hardcoded.
 * Auditoria fail-closed (AB13/P-61, docs/05 §9): registro de escrita obrigatório.
 */
export class DefinirCriterioMonitoramentoUseCase {
  private readonly auditoria: AuditoriaCriterioService;

  constructor(
    private readonly criterios: CriterioRepository,
    private readonly faixasRef: FaixaValorReferencia,
    private readonly eventos: EventPublisher,
    private readonly ids: CriterioIdProvider,
    private readonly clock: ClockProvider,
    audit: AuditCriterioPort,
  ) {
    this.auditoria = new AuditoriaCriterioService(audit);
  }

  async executar(
    input: DefinirCriterioInput,
    signal: AbortSignal,
  ): Promise<CriterioDTO> {
    let faixaValor: FaixaValor | undefined;
    if (input.faixaValorCodigo) {
      const faixas = await this.faixasRef.faixasVigentes(this.clock.agora(), signal);
      const dto = faixas.find(f => f.codigo === input.faixaValorCodigo);
      if (!dto)
        throw new CriterioInvalidoError(
          `faixa de valor desconhecida: ${input.faixaValorCodigo}`,
        );
      faixaValor = FaixaValor.criar(dto.min, dto.max);
    }

    const palavrasChave = input.palavrasChave?.length
      ? PalavrasChave.criar(input.palavrasChave)
      : undefined;

    const criterio = CriterioDeMonitoramento.criar({
      id: this.ids.gerar(),
      tenantId: input.tenantId,
      clienteFinalId: input.clienteFinalId,
      ramoCnae: input.ramoCnae,
      regiaoUf: input.regiaoUf,
      faixaValor,
      palavrasChave,
    });

    await this.criterios.salvar(criterio, signal);

    // Auditoria de escrita fail-closed (AB13/P-61, docs/05 §9 — CRITERIO_MONITORAMENTO é classe crítica).
    // Falha interrompe a operação: o evento NÃO é publicado e o caller recebe erro.
    await this.auditoria.registrarFailClosed(
      {
        operadorId: input.clienteFinalId,
        recurso: `criterio-monitoramento:${criterio.id}`,
        acao: 'ESCREVER',
        baseLegal: 'Lei 14.133/2021 art. 174 — monitoramento de licitações',
        escopo: { tenantId: input.tenantId, clienteFinalId: input.clienteFinalId },
      },
      signal,
    );

    await this.eventos.publicar(
      new CriterioDefinido({
        criterioId: criterio.id,
        clienteFinalId: criterio.clienteFinalId,
      }),
      signal,
    );

    return criterioParaDTO(criterio);
  }
}
