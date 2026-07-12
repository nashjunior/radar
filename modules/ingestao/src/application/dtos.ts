export interface IngestaoResumoDTO {
  modalidade: number;
  janela: { inicio: string; fim: string };
  ingeridos: number;
  atualizados: number;
  erros: number;
}

export interface ReconciliacaoDTO {
  janela: { inicio: string; fim: string };
  verificados: number;
  reingeridos: number;
  erros: number;
}

export interface ItemEditalDTO {
  numeroItem: number;
  descricao: string;
  quantidade: number;
  valorUnitarioEstimado: number | null;
}

export interface EditalDTO {
  id: string;
  numeroControlePncp: string;
  modalidade: { codigo: number; nome: string };
  faseAtual: string;
  objeto: string;
  valorEstimado: number | null;
  prazoProposta: string | null;
  dataPublicacao: string;
  dataAtualizacao: string;
  orgao: { cnpj: string; nome: string; uf: string; municipio: string };
  itens: ItemEditalDTO[];
  /** Proveniência do edital: fonte, data de coleta e base legal (docs/02 §4, docs/05 §5). */
  proveniencia: { fonte: string; dataColeta: string; baseLegal: string };
}

export interface ArquivoDTO {
  /** Identidade real do documento na compra (RAD-291) — `nome` é só metadado de exibição. */
  sequencialDocumento: number;
  nome: string;
  storageKey: string;
  tamanhoBytes: number;
  tipoMime: string;
  /**
   * Enum do PNCP traduzido no Open-Host (2 Edital · 4 Termo de Referência · 7 Estudo Técnico
   * Preliminar · 16 Outros Documentos, arq/02 §6.1) — único jeito confiável de saber qual anexo
   * é o edital; nunca inferir pelo `nome` (texto livre do órgão, P-110/RAD-280).
   */
  tipoDocumentoId: number;
  tipoDocumentoNome: string;
  /** Chave do texto já extraído (`ExtratorDeTexto`, RAD-279) — o que os consumidores devem ler; `storageKey` é só o binário. */
  textoKey: string;
  /** nº de páginas real, medido na extração — alimenta a citação (`p. N`) exibida como prova (P-110). */
  paginas: number;
}

export interface AnexosDTO {
  editalId: string;
  arquivos: ArquivoDTO[];
}
