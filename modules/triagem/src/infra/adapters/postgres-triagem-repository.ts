import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { DbClient } from '@radar/kernel';
import { Triagem } from '../../domain/triagem.js';
import type { Recomendacao, TriagemStatus } from '../../domain/triagem.js';
import { Aderencia } from '../../domain/value-objects/aderencia.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Risco } from '../../domain/value-objects/risco.js';
import type { Severidade } from '../../domain/value-objects/risco.js';
import type { TriagemRepository } from '../../application/ports.js';

/**
 * Triagem é escopada a `tenant_id`/`cliente_final_id` (P-49) — isolamento ESTRUTURAL (docs/05 §3):
 * as colunas de escopo entram no INSERT, nunca só num filtro de query. Chave natural (P-45): 1
 * triagem por (tenant, edital, perfil). A autorização POR OBJETO é do use case (compara o escopo do
 * agregado carregado), nunca só um `WHERE tenant_id = ...` — defesa contra IDOR (A17 §5.3, P-51).
 */
export class PostgresTriagemRepository implements TriagemRepository {
  constructor(private readonly db: DbClient) {}

  async salvar(triagem: Triagem, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO triagem
         (tenant_id, cliente_final_id, edital_id, perfil_id, status, aderencia, recomendacao, riscos)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (tenant_id, edital_id, perfil_id) DO UPDATE SET
         status       = EXCLUDED.status,
         aderencia    = EXCLUDED.aderencia,
         recomendacao = EXCLUDED.recomendacao,
         riscos       = EXCLUDED.riscos`,
      [
        triagem.tenantId,
        triagem.clienteFinalId,
        triagem.editalId,
        triagem.perfilId,
        triagem.status,
        triagem.aderencia?.valor ?? null,
        triagem.recomendacao ?? null,
        JSON.stringify(triagem.riscos.map(riscoToJson)),
      ],
      { signal },
    );
  }

  async porEditalEPerfil(
    tenantId: TenantId,
    clienteFinalId: ClienteFinalId,
    editalId: EditalId,
    perfilId: PerfilId,
    signal: AbortSignal,
  ): Promise<Triagem | null> {
    // Escopo (tenant_id, cliente_final_id) NO WHERE, não só o sub-key: a chave única do agregado é
    // (tenant_id, edital_id, perfil_id) (ver ON CONFLICT no `salvar`) — filtrar só por (edital,
    // perfil) não é único sob multi-tenant (A01 §6) e `rows[0]` sem ORDER BY seria arbitrário,
    // podendo carregar a linha de OUTRO tenant. Com o escopo, o match é a chave única → 1 linha
    // determinística. O authz por objeto do use case (A17 §5.3, P-51) segue como defesa em profundidade.
    const { rows } = await this.db.query<Row>(
      `SELECT tenant_id, cliente_final_id, edital_id, perfil_id, status, aderencia, recomendacao, riscos
         FROM triagem
        WHERE tenant_id = $1 AND cliente_final_id = $2 AND edital_id = $3 AND perfil_id = $4`,
      [tenantId, clienteFinalId, editalId, perfilId],
      { signal },
    );
    const row = rows[0];
    return row ? rowToTriagem(row) : null;
  }
}

interface CitacaoJson {
  pagina: number;
  secao: string | null;
  trecho: string;
}
interface RiscoJson {
  descricao: string;
  severidade: Severidade;
  citacao: CitacaoJson | null;
}
interface Row {
  tenant_id: string;
  cliente_final_id: string;
  edital_id: string;
  perfil_id: string;
  status: string;
  aderencia: number | null;
  recomendacao: string | null;
  riscos: RiscoJson[];
}

function citacaoToJson(c: Citacao | null): CitacaoJson | null {
  return c === null ? null : { pagina: c.pagina, secao: c.secao, trecho: c.trecho };
}

function riscoToJson(r: Risco): RiscoJson {
  return { descricao: r.descricao, severidade: r.severidade, citacao: citacaoToJson(r.citacao) };
}

function rowToTriagem(row: Row): Triagem {
  return Triagem.reconstituir({
    editalId: EditalId(row.edital_id),
    perfilId: PerfilId(row.perfil_id),
    tenantId: TenantId(row.tenant_id),
    clienteFinalId: ClienteFinalId(row.cliente_final_id),
    status: (row.status ?? 'concluida') as TriagemStatus,
    aderencia: row.aderencia !== null ? Aderencia.criar(Number(row.aderencia)) : null,
    recomendacao: row.recomendacao !== null ? (row.recomendacao as Recomendacao) : null,
    riscos: row.riscos.map((r) =>
      Risco.criar(
        r.descricao,
        r.severidade,
        r.citacao === null ? null : Citacao.criar(r.citacao.pagina, r.citacao.trecho, r.citacao.secao ?? undefined),
      ),
    ),
  });
}
