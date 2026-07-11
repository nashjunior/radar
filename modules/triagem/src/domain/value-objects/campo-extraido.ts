import type { Citacao } from './citacao.js';
import type { Confianca } from './confianca.js';

/**
 * Campo extraído do edital: valor + SEU próprio score + SUA citação (A17 §3.1, docs/10 §4, princípio 2).
 * `critico` reflete o `is_critico` do esquema de rótulo (docs/10 §5.2 / A16 §2.2).
 */
export class CampoExtraido<T> {
  private constructor(
    readonly valor: T,
    readonly confianca: Confianca,
    readonly citacao: Citacao | null,
    readonly critico: boolean,
  ) {}

  static criar<T>(p: {
    valor: T;
    confianca: Confianca;
    citacao: Citacao | null;
    critico: boolean;
  }): CampoExtraido<T> {
    return new CampoExtraido(p.valor, p.confianca, p.citacao, p.critico);
  }

  /** Sem citação, não se exibe como fato (docs/10 §4); abaixo do limiar, marca "verificar". */
  exibivelComoFato(limiar: number): boolean {
    return this.citacao !== null && this.confianca.suficiente(limiar);
  }
}
