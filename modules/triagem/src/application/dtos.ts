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
