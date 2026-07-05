import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import {
  CriterioDeMonitoramento,
} from '../../domain/entities/criterio-de-monitoramento.js';
import { FaixaValor } from '../../domain/value-objects/faixa-valor.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import type { CriterioComScore, EditalParaMatchingDTO } from '../../application/dtos.js';
import type { CriterioRepository } from '../../application/ports.js';
import { AderenciaMatching } from '../../domain/value-objects/aderencia-matching.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

/**
 * Implementação PostgreSQL do CriterioRepository.
 * Fan-out: scan SQL + ts_rank no MVP (P-40 — trocar por percolator no Next).
 */
export class PostgresCriterioRepository implements CriterioRepository {
  constructor(private readonly db: DbClient) {}

  async salvar(
    criterio: CriterioDeMonitoramento,
    signal: AbortSignal,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO criterio_monitoramento
         (id, tenant_id, cliente_final_id, ramo_cnae, regiao_uf,
          faixa_valor_min, faixa_valor_max, palavras_chave, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         ramo_cnae      = EXCLUDED.ramo_cnae,
         regiao_uf      = EXCLUDED.regiao_uf,
         faixa_valor_min = EXCLUDED.faixa_valor_min,
         faixa_valor_max = EXCLUDED.faixa_valor_max,
         palavras_chave = EXCLUDED.palavras_chave,
         ativo          = EXCLUDED.ativo`,
      [
        criterio.id,
        criterio.tenantId,
        criterio.clienteFinalId,
        criterio.ramoCnae,
        criterio.regiaoUf,
        criterio.faixaValor?.min ?? null,
        criterio.faixaValor?.max ?? null,
        criterio.palavrasChave?.termos ?? [],
        criterio.ativo,
      ],
      { signal },
    );
  }

  async porId(
    id: CriterioId,
    signal: AbortSignal,
  ): Promise<CriterioDeMonitoramento | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM criterio_monitoramento WHERE id = $1`,
      [id],
      { signal },
    );
    return rows[0] ? rowToCriterio(rows[0]) : null;
  }

  async listarAtivos(signal: AbortSignal): Promise<CriterioDeMonitoramento[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM criterio_monitoramento WHERE ativo = true`,
      [],
      { signal },
    );
    return rows.map(rowToCriterio);
  }

  async casarComEdital(
    edital: EditalParaMatchingDTO,
    signal: AbortSignal,
  ): Promise<CriterioComScore[]> {
    /**
     * Fan-out (P-40): scan SQL com filtros estruturados + ts_rank.
     * 1. WHERE ativo = true
     * 2. AND (ramo_cnae IS NULL OR ramo_cnae = $cnae)
     * 3. AND (regiao_uf IS NULL OR regiao_uf = $uf)
     * 4. AND (faixa_valor_min IS NULL OR $valor >= faixa_valor_min)
     * 5. AND (faixa_valor_max IS NULL OR $valor <= faixa_valor_max)
     * 6. ORDER BY ts_rank(objeto_tsv, plainto_tsquery($palavras)) DESC
     *
     * No MVP single-tenant com poucos critérios, scan é aceitável O(N).
     * Em escala: trocar por percolator (P-40 — [A VALIDAR]).
     */
    const { rows } = await this.db.query<Row & { score: number }>(
      `SELECT c.*,
              CASE
                WHEN c.palavras_chave IS NOT NULL AND array_length(c.palavras_chave, 1) > 0
                THEN ts_rank(
                  to_tsvector('portuguese', $1),
                  plainto_tsquery('portuguese', array_to_string(c.palavras_chave, ' '))
                )
                ELSE 0.5
              END AS score
       FROM criterio_monitoramento c
       WHERE c.ativo = true
         AND (c.ramo_cnae IS NULL OR c.ramo_cnae = $2)
         AND (c.regiao_uf IS NULL OR c.regiao_uf = $3)
         AND (c.faixa_valor_min IS NULL OR $4::numeric >= c.faixa_valor_min)
         AND (c.faixa_valor_max IS NULL OR $4::numeric <= c.faixa_valor_max)
       ORDER BY score DESC`,
      [
        edital.objetoDescricao,
        edital.cnae,
        edital.uf,
        edital.valorEstimado,
      ],
      { signal },
    );

    return rows.map(row => ({
      criterio: rowToCriterio(row),
      score: Math.min(1, Math.max(0, row.score)),
    }));
  }
}

interface Row {
  id: string;
  tenant_id: string;
  cliente_final_id: string;
  ramo_cnae: string | null;
  regiao_uf: string | null;
  faixa_valor_min: number | null;
  faixa_valor_max: number | null;
  palavras_chave: string[] | null;
  ativo: boolean;
}

function rowToCriterio(row: Row): CriterioDeMonitoramento {
  return CriterioDeMonitoramento.reconstituir({
    id: CriterioId(row.id),
    tenantId: row.tenant_id as TenantId,
    clienteFinalId: row.cliente_final_id as ClienteFinalId,
    ramoCnae: row.ramo_cnae ?? undefined,
    regiaoUf: row.regiao_uf ?? undefined,
    faixaValor:
      row.faixa_valor_min !== null || row.faixa_valor_max !== null
        ? FaixaValor.criar(row.faixa_valor_min, row.faixa_valor_max)
        : undefined,
    palavrasChave:
      row.palavras_chave?.length
        ? PalavrasChave.criar(row.palavras_chave)
        : undefined,
    ativo: row.ativo,
  });
}
