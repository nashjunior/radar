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
}

export interface AnexosDTO {
  editalId: string;
  arquivos: ArquivoDTO[];
}
