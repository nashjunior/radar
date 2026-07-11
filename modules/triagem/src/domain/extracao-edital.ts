import type { EditalId } from '@radar/kernel';
import { Confianca } from './value-objects/confianca.js';
import type { CampoExtraido } from './value-objects/campo-extraido.js';
import type { Requisito } from './value-objects/requisito.js';
import type { Risco } from './value-objects/risco.js';

export interface MontarExtracaoProps {
  editalId: EditalId;
  objeto: CampoExtraido<string>;
  valorEstimado: CampoExtraido<number | null>;
  dataAberturaPropostas: CampoExtraido<Date | null>;
  requisitos: readonly Requisito[];
  riscosBrutos: readonly Risco[];
  paginas: number;
}

/**
 * Agregado raiz do contexto Análise & Triagem (docs/13 §3): os FATOS do edital.
 * 1 por edital, CACHEÁVEL (P-45) — catálogo GLOBAL, sem `tenantId` (docs/12 §2). Imutável.
 *
 * `paginas` é a origem de `paginasEdital` no contrato de leitura (A17 §4.2 `TriagemLeituraDTO`);
 * o worker mede ao hidratar (`EntradaExtracaoDTO.paginas`, A17 §4.2) — RAD-42.
 */
export class ExtracaoEdital {
  private constructor(
    readonly editalId: EditalId,
    readonly objeto: CampoExtraido<string>,
    readonly valorEstimado: CampoExtraido<number | null>, // null = sigiloso/omitido (docs/10 §5.2)
    readonly dataAberturaPropostas: CampoExtraido<Date | null>,
    readonly requisitos: readonly Requisito[],
    readonly riscosBrutos: readonly Risco[],
    readonly paginas: number,
  ) {}

  static montar(p: MontarExtracaoProps): ExtracaoEdital {
    return new ExtracaoEdital(
      p.editalId,
      p.objeto,
      p.valorEstimado,
      p.dataAberturaPropostas,
      [...p.requisitos],
      [...p.riscosBrutos],
      p.paginas,
    );
  }

  private get camposCriticos(): CampoExtraido<unknown>[] {
    const campos: CampoExtraido<unknown>[] = [
      this.objeto,
      this.valorEstimado,
      this.dataAberturaPropostas,
    ];
    return campos.filter((c) => c.critico);
  }

  /**
   * Confiança agregada = a MENOR entre os campos críticos: um único campo crítico fraco derruba a
   * extração inteira (docs/10 §4). É o `confianca` persistido (docs/12 §1) e o `confiancaIA` do read
   * path (A17 §4.2). Sem campos críticos, é 1 (nada a reprovar).
   */
  confiancaGlobal(): Confianca {
    return this.camposCriticos.reduce(
      (min, c) => Confianca.menor(min, c.confianca),
      Confianca.criar(1),
    );
  }

  suficiente(limiar: number): boolean {
    return this.confiancaGlobal().suficiente(limiar);
  }
}
