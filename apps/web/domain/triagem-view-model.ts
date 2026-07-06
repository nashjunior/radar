import type { EditalId, PerfilId } from '@radar/kernel';

export interface CampoAnaliseIA {
  readonly titulo: string;
  readonly conteudo: string;
  readonly fonte: string;
  /** Flag explícito para a UI — evita inferência frágil via `conteudo === 'verificar'` (RAD-79). */
  readonly estado: 'ok' | 'verificar';
}

export interface ChecklistItem {
  readonly ok: boolean;
  readonly texto: string;
}

/** Ciclo de vida da triagem (RAD-79). */
export type TriagemStatus = 'processando' | 'concluida' | 'incompleta' | 'falha_ocr' | 'recusada';

/** View model de Triagem — o que a UI precisa exibir (A12 §3.1, RAD-79). */
export type TriagemViewModel =
  | { readonly status: 'processando' | 'falha_ocr' | 'recusada' }
  | {
      readonly status: 'concluida' | 'incompleta';
      readonly editalId: EditalId;
      readonly perfilId: PerfilId;
      readonly aderencia: number;
      readonly recomendacao: 'go' | 'no-go';
      readonly checklist: readonly ChecklistItem[];
      readonly camposAnalise: readonly CampoAnaliseIA[];
      readonly confiancaIA: number;
      readonly paginasEdital: number;
    };

/** Regra de apresentação: converte aderência [0,1] em label legível. */
export function aderenciaLabel(aderencia: number): string {
  if (aderencia >= 0.8) return 'Alta';
  if (aderencia >= 0.5) return 'Média';
  return 'Baixa';
}
