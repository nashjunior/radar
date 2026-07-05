import { RequisitoInvalidoError } from '../errors/index.js';
import type { Citacao } from './citacao.js';

export type CategoriaHabilitacao = 'juridica' | 'fiscal' | 'tecnica' | 'economica';

/**
 * Exigência de habilitação extraída do edital (A17 §3.1). Cada requisito carrega a citação de
 * origem — sem fonte, não vira afirmação (docs/10 §4). Alimenta o `checklist` do read path (A17 §4.3).
 */
export class Requisito {
  private constructor(
    readonly categoria: CategoriaHabilitacao,
    readonly descricao: string,
    readonly citacao: Citacao | null,
  ) {}

  static criar(
    categoria: CategoriaHabilitacao,
    descricao: string,
    citacao: Citacao | null,
  ): Requisito {
    if (descricao.trim().length === 0) throw new RequisitoInvalidoError();
    return new Requisito(categoria, descricao.trim(), citacao);
  }
}
