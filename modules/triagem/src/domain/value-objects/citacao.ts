import { CitacaoInvalidaError } from '../errors/index.js';

/**
 * Citação = trecho-fonte + página (A17 §3.1, docs/10 §4). Toda afirmação exibida como fato linka o
 * trecho: é regra de qualidade E de segurança — conteúdo inventado por injeção não tem citação que
 * bate (A11 §2, camada 6).
 */
export class Citacao {
  private constructor(
    readonly pagina: number,
    readonly secao: string | null,
    readonly trecho: string,
  ) {}

  static criar(pagina: number, trecho: string, secao?: string): Citacao {
    if (pagina < 1 || trecho.trim().length === 0) throw new CitacaoInvalidaError();
    return new Citacao(pagina, secao ?? null, trecho.trim());
  }

  /** Fonte renderizada para o read path (A17 §4.3): "p. 12, seção 5.1" | "p. 12". */
  toString(): string {
    return this.secao ? `p. ${this.pagina}, seção ${this.secao}` : `p. ${this.pagina}`;
  }
}
