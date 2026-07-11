import { EditalId } from '@radar/kernel';
import type { DbClient } from '@radar/kernel';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';
import { Requisito } from '../../domain/value-objects/requisito.js';
import type { CategoriaHabilitacao } from '../../domain/value-objects/requisito.js';
import { Risco } from '../../domain/value-objects/risco.js';
import type { Severidade } from '../../domain/value-objects/risco.js';
import type { ExtracaoRepository } from '../../application/ports.js';

/**
 * Catálogo GLOBAL e cacheável (P-45): a chave é o `edital_id`, SEM `tenant_id` (docs/12 §2). Upsert
 * idempotente por edital — reprocessar `edital.ingerido` é seguro. Estrutura conforme docs/12 §1.
 */
export class PostgresExtracaoRepository implements ExtracaoRepository {
  constructor(private readonly db: DbClient) {}

  async porEdital(id: EditalId, signal: AbortSignal): Promise<ExtracaoEdital | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT edital_id, objeto, valor_estimado, data_abertura_propostas,
              requisitos, riscos_brutos, paginas
         FROM extracao_edital
        WHERE edital_id = $1`,
      [id],
      { signal },
    );
    const row = rows[0];
    return row ? rowToExtracao(row) : null;
  }

  async salvar(extracao: ExtracaoEdital, signal: AbortSignal): Promise<void> {
    await this.db.query(
      `INSERT INTO extracao_edital
         (edital_id, objeto, valor_estimado, data_abertura_propostas,
          requisitos, riscos_brutos, confianca, paginas)
       VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8)
       ON CONFLICT (edital_id) DO UPDATE SET
         objeto                  = EXCLUDED.objeto,
         valor_estimado          = EXCLUDED.valor_estimado,
         data_abertura_propostas = EXCLUDED.data_abertura_propostas,
         requisitos              = EXCLUDED.requisitos,
         riscos_brutos           = EXCLUDED.riscos_brutos,
         confianca               = EXCLUDED.confianca,
         paginas                 = EXCLUDED.paginas`,
      [
        extracao.editalId,
        JSON.stringify(campoToJson(extracao.objeto)),
        JSON.stringify(campoToJson(extracao.valorEstimado)),
        JSON.stringify(campoToJson(extracao.dataAberturaPropostas)),
        JSON.stringify(extracao.requisitos.map(requisitoToJson)),
        JSON.stringify(extracao.riscosBrutos.map(riscoToJson)),
        extracao.confiancaGlobal().valor, // denormalizado p/ query (docs/12 §1)
        extracao.paginas,
      ],
      { signal },
    );
  }
}

// ---------------------------------------------------------------------------
// Serialização (jsonb). O DB é fonte CONFIÁVEL — reconstrói via factories do domínio.
// ---------------------------------------------------------------------------

interface CitacaoJson {
  pagina: number;
  secao: string | null;
  trecho: string;
}
interface CampoJson {
  valor: unknown;
  confianca: number;
  citacao: CitacaoJson | null;
  critico: boolean;
}
interface RequisitoJson {
  categoria: CategoriaHabilitacao;
  descricao: string;
  citacao: CitacaoJson | null;
}
interface RiscoJson {
  descricao: string;
  severidade: Severidade;
  citacao: CitacaoJson | null;
}
interface Row {
  edital_id: string;
  objeto: CampoJson;
  valor_estimado: CampoJson;
  data_abertura_propostas: CampoJson;
  requisitos: RequisitoJson[];
  riscos_brutos: RiscoJson[];
  paginas: number;
}

function citacaoToJson(c: Citacao | null): CitacaoJson | null {
  return c === null ? null : { pagina: c.pagina, secao: c.secao, trecho: c.trecho };
}

function jsonToCitacao(c: CitacaoJson | null): Citacao | null {
  return c === null ? null : Citacao.criar(c.pagina, c.trecho, c.secao ?? undefined);
}

function campoToJson(c: CampoExtraido<unknown>): CampoJson {
  const valor = c.valor;
  return {
    valor: valor instanceof Date ? valor.toISOString() : valor,
    confianca: c.confianca.valor,
    citacao: citacaoToJson(c.citacao),
    critico: c.critico,
  };
}

function jsonToCampo<T>(c: CampoJson, valorFn: (v: unknown) => T): CampoExtraido<T> {
  return CampoExtraido.criar<T>({
    valor: valorFn(c.valor),
    confianca: Confianca.criar(c.confianca),
    citacao: jsonToCitacao(c.citacao),
    critico: c.critico,
  });
}

function requisitoToJson(r: Requisito): RequisitoJson {
  return { categoria: r.categoria, descricao: r.descricao, citacao: citacaoToJson(r.citacao) };
}

function riscoToJson(r: Risco): RiscoJson {
  return { descricao: r.descricao, severidade: r.severidade, citacao: citacaoToJson(r.citacao) };
}

function rowToExtracao(row: Row): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EditalId(row.edital_id),
    objeto: jsonToCampo<string>(row.objeto, (v) => String(v)),
    valorEstimado: jsonToCampo<number | null>(row.valor_estimado, (v) => (v === null ? null : Number(v))),
    dataAberturaPropostas: jsonToCampo<Date | null>(row.data_abertura_propostas, (v) =>
      v === null ? null : new Date(String(v)),
    ),
    requisitos: row.requisitos.map((r) => Requisito.criar(r.categoria, r.descricao, jsonToCitacao(r.citacao))),
    riscosBrutos: row.riscos_brutos.map((r) =>
      Risco.criar(r.descricao, r.severidade, jsonToCitacao(r.citacao)),
    ),
    paginas: row.paginas,
  });
}
