import type { EditalId, PerfilId } from '@radar/kernel';

export interface CampoAnaliseIA {
  readonly titulo: string;
  readonly conteudo: string;
  readonly fonte: string;
}

export interface ChecklistItem {
  readonly ok: boolean;
  readonly texto: string;
}

/** View model de Triagem — o que a UI precisa exibir (A12 §3.1). */
export interface TriagemViewModel {
  readonly editalId: EditalId;
  readonly perfilId: PerfilId;
  readonly aderencia: number;
  readonly recomendacao: 'go' | 'no-go';
  readonly checklist: readonly ChecklistItem[];
  readonly camposAnalise: readonly CampoAnaliseIA[];
  readonly confiancaIA: number;
  readonly paginasEdital: number;
}

/** Regra de apresentação: converte aderência [0,1] em label legível. */
export function aderenciaLabel(aderencia: number): string {
  if (aderencia >= 0.8) return 'Alta';
  if (aderencia >= 0.5) return 'Média';
  return 'Baixa';
}
