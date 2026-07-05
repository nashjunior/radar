import { DomainError } from '@radar/kernel';

/** Aderência de matching fora do intervalo válido [0,1]. */
export class AderenciaMatchingInvalidaError extends DomainError {
  readonly code = 'ADERENCIA_MATCHING_INVALIDA' as const;
  constructor(valor: number) {
    super(`aderência de matching fora de [0,1]: ${valor}`);
  }
}

/** Faixa de valor inválida (min > max). */
export class FaixaValorInvalidaError extends DomainError {
  readonly code = 'FAIXA_VALOR_INVALIDA' as const;
  constructor(min: number, max: number) {
    super(`faixa inválida: min ${min} > max ${max}`);
  }
}

/** Critério sem ao menos ramo/CNAE ou palavras-chave. */
export class PalavrasChaveVaziaError extends DomainError {
  readonly code = 'PALAVRAS_CHAVE_VAZIAS' as const;
  constructor() {
    super('critério requer ao menos uma palavra-chave');
  }
}

/** Critério de monitoramento inválido. */
export class CriterioInvalidoError extends DomainError {
  readonly code = 'CRITERIO_INVALIDO' as const;
  constructor(msg: string) {
    super(msg);
  }
}

/** Alerta não encontrado pelo identificador informado. */
export class AlertaNaoEncontradoError extends DomainError {
  readonly code = 'ALERTA_NAO_ENCONTRADO' as const;
  constructor(id: string) {
    super(`alerta não encontrado: ${id}`);
  }
}

// AcessoNegadoError vive no @radar/kernel — re-exportada para conveniência dos consumidores.
export { AcessoNegadoError } from '@radar/kernel';
