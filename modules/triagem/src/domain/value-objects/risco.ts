import type { Citacao } from './citacao.js';

export type Severidade = 'baixa' | 'media' | 'alta';

/**
 * Lacuna de habilitação da empresa perante um requisito do edital (A17 §3.1). No read path (A17 §4.3)
 * cada risco vira um item `checklist.ok === false` — os `riscos[]` do domínio NÃO cruzam o contrato de
 * leitura. Herda a citação do requisito de origem (docs/10 §4).
 */
export class Risco {
  private constructor(
    readonly descricao: string,
    readonly severidade: Severidade,
    readonly citacao: Citacao | null,
  ) {}

  static criar(descricao: string, severidade: Severidade, citacao: Citacao | null): Risco {
    return new Risco(descricao, severidade, citacao);
  }
}
