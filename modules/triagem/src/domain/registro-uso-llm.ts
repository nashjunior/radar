import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { UsoLlmInvalidoError } from './errors/index.js';

export interface CriarRegistroUsoLlmProps {
  readonly editalId: EditalId;
  /**
   * Escopo de quem DISPAROU a chamada — presente só quando ela nasce de uma triagem por perfil
   * (cache-miss em `TriarEditalUseCase`); `null` na pré-extração global/em lote (`ExtrairEditalUseCase`,
   * `ExtrairEditaisEmLoteUseCase` — P-45/P-92), que roda ANTES de qualquer usuário pedir triagem e não
   * tem tenant a atribuir (docs/98 P-20, veredicto RAD-227: a extração escala com o volume do PNCP
   * ingerido, não com a cota vendida — as duas unidades "não se encontram").
   */
  readonly tenantId: TenantId | null;
  readonly clienteFinalId: ClienteFinalId | null;
  readonly perfilId: PerfilId | null;
  readonly modelo: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  /** USD — moeda de cobrança do provedor (P-66); conversão a BRL é do relatório/leitura, nunca do fato gravado (risco de câmbio, docs/09 §6.4). */
  readonly custoUsd: number;
  readonly ocorridoEm: Date;
}

/**
 * Fato IMUTÁVEL de consumo de UMA chamada ao LLM — append-only (RAD-230, P-20/P-38). Sem `id`
 * próprio: como `Triagem` (mesmo módulo), o surrogate key é da tabela (`BIGSERIAL`), nunca do
 * domínio — a identidade aqui é a ocorrência em si, não uma entidade referenciável.
 *
 * Distinto da Trilha de Auditoria da Governança (`RegistroAuditoria`, P-100/AB13): mesmo padrão
 * append-only, propósito diferente — este é ledger de USO/FATURAMENTO (docs/09 §6.1), não auditoria
 * de acesso a dado pessoal; por isso é uma tabela própria da Triagem, não a `AuditLogRepository`.
 *
 * 1 registro por CHAMADA ao LLM, não por triagem/edital: cada vez que `LlmGateway.extrair`/
 * `LlmLoteGateway.extrairLote` roda, grava-se 1 linha — nunca sobrescreve (ao contrário de `triagem`,
 * que faz UPSERT por `(tenant, edital, perfil)` e por isso não serve para contar execuções, P-38).
 */
export class RegistroUsoLlm {
  private constructor(
    readonly editalId: EditalId,
    readonly tenantId: TenantId | null,
    readonly clienteFinalId: ClienteFinalId | null,
    readonly perfilId: PerfilId | null,
    readonly modelo: string,
    readonly inputTokens: number,
    readonly outputTokens: number,
    readonly cacheReadInputTokens: number,
    readonly cacheCreationInputTokens: number,
    readonly custoUsd: number,
    readonly ocorridoEm: Date,
  ) {}

  static criar(props: CriarRegistroUsoLlmProps): RegistroUsoLlm {
    if (props.modelo.trim().length === 0) throw new UsoLlmInvalidoError('modelo ausente');
    const numericos: ReadonlyArray<readonly [string, number]> = [
      ['inputTokens', props.inputTokens],
      ['outputTokens', props.outputTokens],
      ['cacheReadInputTokens', props.cacheReadInputTokens],
      ['cacheCreationInputTokens', props.cacheCreationInputTokens],
      ['custoUsd', props.custoUsd],
    ];
    for (const [campo, valor] of numericos) {
      if (!Number.isFinite(valor) || valor < 0) {
        throw new UsoLlmInvalidoError(`${campo} inválido: ${valor}`);
      }
    }
    return new RegistroUsoLlm(
      props.editalId,
      props.tenantId,
      props.clienteFinalId,
      props.perfilId,
      props.modelo,
      props.inputTokens,
      props.outputTokens,
      props.cacheReadInputTokens,
      props.cacheCreationInputTokens,
      props.custoUsd,
      props.ocorridoEm,
    );
  }
}
