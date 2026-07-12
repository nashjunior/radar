import type { DbClient, TenantId } from '@radar/kernel';
import type { RegistroUsoLlm } from '../../domain/registro-uso-llm.js';
import type { UsoLlmLedger } from '../../application/ports.js';

/**
 * Ledger APPEND-ONLY de uso de LLM (RAD-230, P-20/P-38) — sempre INSERT, nunca UPSERT (ao contrário
 * de `PostgresTriagemRepository.salvar`, que faz `ON CONFLICT DO UPDATE`): é exatamente essa
 * diferença que corrige a Lacuna 2 (`COUNT(*)` em `triagem` conta agregados distintos, não
 * execuções). `id` é `BIGSERIAL` da tabela — como `Triagem`, o domínio não carrega surrogate key.
 */
export class PostgresUsoLlmLedger implements UsoLlmLedger {
  constructor(private readonly db: DbClient) {}

  async registrar(registro: RegistroUsoLlm, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO registro_uso_llm
         (edital_id, tenant_id, cliente_final_id, perfil_id, modelo,
          input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens,
          custo_usd, ocorrido_em)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        registro.editalId,
        registro.tenantId,
        registro.clienteFinalId,
        registro.perfilId,
        registro.modelo,
        registro.inputTokens,
        registro.outputTokens,
        registro.cacheReadInputTokens,
        registro.cacheCreationInputTokens,
        registro.custoUsd,
        registro.ocorridoEm,
      ],
      { signal },
    );
  }

  /**
   * Soma de `custo_usd` desde `desde` (RAD-243, orçamento acumulado por janela). `tenantId: null` =
   * GLOBAL, soma todas as linhas (usa `idx_registro_uso_llm_global_janela`, migração 004); tenantId
   * presente = só as linhas daquele tenant (`idx_registro_uso_llm_tenant_janela`, RAD-230).
   */
  async gastoUsdNaJanela(
    escopo: { readonly tenantId: TenantId | null },
    desde: Date,
    signal: AbortSignal,
  ): Promise<number> {
    const resultado = await this.db.query<{ soma: string | null }>(
      `SELECT SUM(custo_usd) AS soma
         FROM registro_uso_llm
        WHERE ocorrido_em >= $1
          AND ($2::text IS NULL OR tenant_id = $2)`,
      [desde, escopo.tenantId],
      { signal },
    );
    return Number(resultado.rows[0]?.soma ?? 0);
  }
}
