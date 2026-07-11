/** View model do Detalhe do Edital — alimentado por EditalGateway (RAD-111). */
export interface EditalDetalhe {
  readonly id: string;
  readonly titulo: string;
  readonly modalidade: string;
  readonly numero: string;
  readonly orgao: { readonly nome: string; readonly uf: string };
  readonly valorEstimado: number | null;
  readonly dataAbertura: string;
  readonly modoDisputa: string;
  /** Proveniência do edital (contrato RAD-72 / bab8e09). */
  readonly proveniencia: {
    readonly fonte: string;
    readonly dataColeta: string;
    readonly baseLegal: string;
  };
}

/** Formata ISO 8601 → DD/MM/AAAA para exibição da proveniência. */
export function formatarDataColeta(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
