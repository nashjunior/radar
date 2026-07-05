import type { EditalId } from '@radar/kernel';
import type { EditalRepository } from '../../application/ports.js';
import type { Edital } from '../../domain/entities/edital.js';
import { Edital as EditalEntity } from '../../domain/entities/edital.js';

interface DbClient {
  query<R extends object>(
    sql: string,
    params: unknown[],
    opts?: { signal?: AbortSignal },
  ): Promise<{ rows: R[] }>;
}

interface ItemJson {
  numeroItem: number;
  descricao: string;
  quantidade: number;
  valorUnitarioEstimado: string | null;
}

interface Row {
  id: string;
  numero_controle_pncp: string;
  modalidade_codigo: number;
  modalidade_nome: string;
  fase_atual: string;
  objeto: string;
  valor_estimado: string | null;
  prazo_proposta: Date | null;
  data_publicacao: Date;
  data_atualizacao: Date;
  orgao_cnpj: string;
  orgao_nome: string;
  orgao_uf: string;
  orgao_municipio: string;
  prov_fonte: string;
  prov_base_legal: string;
  prov_coletado_em: Date;
  itens: ItemJson[];
}

function rowToEdital(row: Row): Edital {
  return EditalEntity.criar({
    id: row.id as EditalId,
    numeroControlePncp: row.numero_controle_pncp,
    modalidadeCodigo: Number(row.modalidade_codigo),
    modalidadeNome: row.modalidade_nome,
    faseAtual: row.fase_atual,
    objeto: row.objeto,
    valorEstimado: row.valor_estimado,
    prazoProposta: row.prazo_proposta ? new Date(row.prazo_proposta) : null,
    dataPublicacao: new Date(row.data_publicacao),
    dataAtualizacao: new Date(row.data_atualizacao),
    orgao: {
      cnpj: row.orgao_cnpj,
      nome: row.orgao_nome,
      uf: row.orgao_uf,
      municipio: row.orgao_municipio,
    },
    proveniencia: {
      fonte: row.prov_fonte,
      baseLegal: row.prov_base_legal,
      coletadoEm: new Date(row.prov_coletado_em),
    },
    itens: row.itens.map((i) => ({
      numeroItem: i.numeroItem,
      descricao: i.descricao,
      quantidade: i.quantidade,
      valorUnitarioEstimado: i.valorUnitarioEstimado,
    })),
  });
}

/**
 * Adaptador PostgreSQL para o repositório de editais.
 * Upsert por `numero_controle_pncp` (UNIQUE) garante idempotência (A02, §3).
 * Proveniência é desnormalizada na linha para evitar join no read path.
 */
export class PostgresEditalRepository implements EditalRepository {
  constructor(private readonly db: DbClient) {}

  async upsertPorNumeroControle(edital: Edital, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO editais
         (id, numero_controle_pncp, modalidade_codigo, modalidade_nome,
          fase_atual, objeto, valor_estimado, prazo_proposta,
          data_publicacao, data_atualizacao,
          orgao_cnpj, orgao_nome, orgao_uf, orgao_municipio,
          prov_fonte, prov_base_legal, prov_coletado_em, itens)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb)
       ON CONFLICT (numero_controle_pncp) DO UPDATE SET
         fase_atual       = EXCLUDED.fase_atual,
         objeto           = EXCLUDED.objeto,
         valor_estimado   = EXCLUDED.valor_estimado,
         prazo_proposta   = EXCLUDED.prazo_proposta,
         data_atualizacao = EXCLUDED.data_atualizacao,
         prov_coletado_em = EXCLUDED.prov_coletado_em,
         itens            = EXCLUDED.itens`,
      [
        edital.id,
        edital.numeroControlePncp.valor,
        edital.modalidade.codigo,
        edital.modalidade.nome,
        edital.faseAtual,
        edital.objeto,
        edital.valorEstimado?.representacaoDecimal ?? null,
        edital.prazoProposta?.toISOString() ?? null,
        edital.dataPublicacao.toISOString(),
        edital.dataAtualizacao.toISOString(),
        edital.orgao.cnpj.valor,
        edital.orgao.nome,
        edital.orgao.uf,
        edital.orgao.municipio,
        edital.proveniencia.fonte,
        edital.proveniencia.baseLegal,
        edital.proveniencia.coletadoEm.toISOString(),
        JSON.stringify(
          edital.itens.map((i) => ({
            numeroItem: i.numeroItem,
            descricao: i.descricao,
            quantidade: i.quantidade,
            valorUnitarioEstimado: i.valorUnitarioEstimado?.representacaoDecimal ?? null,
          })),
        ),
      ],
      { signal },
    );
  }

  async porId(id: EditalId, signal: AbortSignal): Promise<Edital | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT id, numero_controle_pncp, modalidade_codigo, modalidade_nome,
              fase_atual, objeto, valor_estimado, prazo_proposta,
              data_publicacao, data_atualizacao,
              orgao_cnpj, orgao_nome, orgao_uf, orgao_municipio,
              prov_fonte, prov_base_legal, prov_coletado_em, itens
         FROM editais
        WHERE id = $1`,
      [id],
      { signal },
    );
    return rows[0] ? rowToEdital(rows[0]) : null;
  }

  async porNumeroControle(
    numeroPncp: string,
    signal: AbortSignal,
  ): Promise<Edital | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT id, numero_controle_pncp, modalidade_codigo, modalidade_nome,
              fase_atual, objeto, valor_estimado, prazo_proposta,
              data_publicacao, data_atualizacao,
              orgao_cnpj, orgao_nome, orgao_uf, orgao_municipio,
              prov_fonte, prov_base_legal, prov_coletado_em, itens
         FROM editais
        WHERE numero_controle_pncp = $1`,
      [numeroPncp],
      { signal },
    );
    return rows[0] ? rowToEdital(rows[0]) : null;
  }

  async *listarPorJanelaPublicacao(
    janela: { inicio: Date; fim: Date },
    signal: AbortSignal,
  ): AsyncGenerator<Edital[]> {
    const PAGE = 100;
    let cursor = '';
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { rows } = await this.db.query<Row>(
        `SELECT id, numero_controle_pncp, modalidade_codigo, modalidade_nome,
                fase_atual, objeto, valor_estimado, prazo_proposta,
                data_publicacao, data_atualizacao,
                orgao_cnpj, orgao_nome, orgao_uf, orgao_municipio,
                prov_fonte, prov_base_legal, prov_coletado_em, itens
           FROM editais
          WHERE data_publicacao BETWEEN $1 AND $2
            AND id > $3
          ORDER BY id
          LIMIT $4`,
        [janela.inicio.toISOString(), janela.fim.toISOString(), cursor, PAGE],
        { signal },
      );
      if (rows.length === 0) break;
      yield rows.map(rowToEdital);
      cursor = rows[rows.length - 1]!.id;
      if (rows.length < PAGE) break;
    }
  }
}
