import type { ExtracaoEdital } from '../domain/extracao-edital.js';
import type { Recomendacao, Triagem } from '../domain/triagem.js';
import type { CampoExtraido } from '../domain/value-objects/campo-extraido.js';
import type { Citacao } from '../domain/value-objects/citacao.js';

/**
 * CONTRATO DE LEITURA SÍNCRONO — BFF `GET /api/triagem/:editalId` (docs/98 P-86, RAD-31/RAD-42).
 *
 * É DISTINTO do evento/comando `triagem.concluida` (Published Language, que carrega `riscos[]`):
 * a fonte da verdade EXECUTÁVEL do shape é o front (a SPA fixou o contrato), espelhado em
 * `apps/web/domain/triagem-view-model.ts` e `apps/api/src/routes/triagem.ts::TriagemResponseSchema`.
 *
 * NÃO carrega `riscos[]`: as lacunas de habilitação são exatamente os itens `checklist.ok === false`.
 */
export interface TriagemLeituraDTO {
  editalId: string;
  perfilId: string;
  /** [0,1] — `Triagem.aderencia.valor`. */
  aderencia: number;
  recomendacao: 'go' | 'no-go';
  /** [0,1] — `ExtracaoEdital.confiancaGlobal().valor`. */
  confiancaIA: number;
  /** `ExtracaoEdital.paginas` (A17 §3). */
  paginasEdital: number;
  /** Projeção dos `CampoExtraido` para apresentação (A17 §4.3). */
  camposAnalise: CampoAnaliseDTO[];
  /** 1 item por `Requisito`; `ok:false` = lacuna (risco do domínio) — A17 §4.3. */
  checklist: ChecklistItemDTO[];
}

export interface CampoAnaliseDTO {
  titulo: string;
  /** Valor renderizado; "verificar" quando o campo não é exibível como fato (sem citação, §6). */
  conteudo: string;
  /** Citação renderizada ("p. 12, seção 5.1") ou "" quando ausente. */
  fonte: string;
}

export interface ChecklistItemDTO {
  ok: boolean;
  texto: string;
}

// ---------------------------------------------------------------------------
// Contratos do caminho COMANDO/WORKER (A17 §4.2) — distintos do read DTO acima.
// ---------------------------------------------------------------------------

export interface CitacaoDTO {
  pagina: number;
  secao: string | null;
  trecho: string;
}

/**
 * Entrada da extração pelo LLM (A17 §4.2). Contexto MÍNIMO (P-54): SÓ o edital e anexos —
 * nunca a classe crítica, a estratégia comercial ou dado de outro tenant/perfil.
 */
export interface EntradaExtracaoDTO {
  editalId: string;
  texto: string; // texto selecionável já extraído (ou saída do OCR)
  temTextoSelecionavel: boolean; // false → passou por OCR (docs/10 §3)
  anexos: string[]; // texto de cada anexo, já resolvido do ObjectStorage
  paginas: number; // nº de páginas do PDF/OCR — medido ao hidratar; alimenta ExtracaoEdital.paginas
}

export interface CampoExtracaoDTO {
  nome: string;
  valor: unknown;
  confianca: number;
  citacao: CitacaoDTO | null;
}

export interface ExtracaoEditalDTO {
  editalId: string;
  objeto: string;
  confianca: number; // confiança agregada (mínimo dos campos críticos)
  campos: CampoExtracaoDTO[];
}

export interface RiscoDTO {
  descricao: string;
  severidade: string;
  citacao: CitacaoDTO | null;
}

/** Payload de comando `triagem.concluida` (A17 §4.2) — carrega `riscos[]` (≠ read DTO síncrono). */
export interface TriagemDTO {
  editalId: string;
  perfilId: string;
  aderencia: number;
  recomendacao: Recomendacao; // sugestão — a decisão é do usuário (HITL)
  riscos: RiscoDTO[];
}

// ---------------------------------------------------------------------------
// Mappers domínio → DTO (mesma convenção de `alertaParaDTO` do Matching).
// ---------------------------------------------------------------------------

function citacaoParaDTO(c: Citacao | null): CitacaoDTO | null {
  return c === null ? null : { pagina: c.pagina, secao: c.secao, trecho: c.trecho };
}

function campoParaDTO(nome: string, campo: CampoExtraido<unknown>): CampoExtracaoDTO {
  return {
    nome,
    valor: campo.valor,
    confianca: campo.confianca.valor,
    citacao: citacaoParaDTO(campo.citacao),
  };
}

export function extracaoParaDTO(e: ExtracaoEdital): ExtracaoEditalDTO {
  return {
    editalId: e.editalId,
    objeto: e.objeto.valor,
    confianca: e.confiancaGlobal().valor,
    campos: [
      campoParaDTO('objeto', e.objeto),
      campoParaDTO('valorEstimado', e.valorEstimado),
      campoParaDTO('dataAberturaPropostas', e.dataAberturaPropostas),
    ],
  };
}

export function triagemParaDTO(t: Triagem): TriagemDTO {
  return {
    editalId: t.editalId,
    perfilId: t.perfilId,
    aderencia: t.aderencia.valor,
    recomendacao: t.recomendacao,
    riscos: t.riscos.map((r) => ({
      descricao: r.descricao,
      severidade: r.severidade,
      citacao: citacaoParaDTO(r.citacao),
    })),
  };
}
