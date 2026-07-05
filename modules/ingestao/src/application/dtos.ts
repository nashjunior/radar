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
}

export interface ArquivoDTO {
  nome: string;
  storageKey: string;
  tamanhoBytes: number;
  tipoMime: string;
}

export interface AnexosDTO {
  editalId: string;
  arquivos: ArquivoDTO[];
}
