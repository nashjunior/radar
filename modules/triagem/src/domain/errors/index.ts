import { DomainError } from '@radar/kernel';

/**
 * Catálogo de erros do contexto Análise & Triagem (A17 §3.2).
 * Todo `code` é estável e mapeado para HTTP/gRPC na borda (A17 §5.3, A10 §6).
 * `AcessoNegadoError` (IDOR/cross-tenant) vem do Shared Kernel `@radar/kernel` (P-51).
 */

export class ConfiancaInvalidaError extends DomainError {
  readonly code = 'CONFIANCA_INVALIDA' as const;
  constructor(valor: number) {
    super(`confiança fora de [0,1]: ${valor}`);
  }
}

/** Extração abaixo do limiar → degradar para leitura assistida (docs/10 §6). Borda: 422. */
export class ConfiancaInsuficienteError extends DomainError {
  readonly code = 'CONFIANCA_INSUFICIENTE' as const;
  constructor() {
    super('extração abaixo do limiar de confiança — degradar para leitura assistida');
  }
}

export class AderenciaInvalidaError extends DomainError {
  readonly code = 'ADERENCIA_INVALIDA' as const;
  constructor(valor: number) {
    super(`aderência fora de [0,1]: ${valor}`);
  }
}

export class CitacaoInvalidaError extends DomainError {
  readonly code = 'CITACAO_INVALIDA' as const;
  constructor() {
    super('citação requer página válida e trecho não-vazio');
  }
}

export class RequisitoInvalidoError extends DomainError {
  readonly code = 'REQUISITO_INVALIDO' as const;
  constructor() {
    super('requisito requer descrição não-vazia');
  }
}

/** OCR falhou / PDF-imagem ilegível (docs/10 §6). Não inventar conteúdo. Borda: 422. */
export class OcrFalhouError extends DomainError {
  readonly code = 'OCR_FALHOU' as const;
  constructor() {
    super('OCR falhou — marcar "requer leitura manual"');
  }
}

/** Saída do LLM não bate no schema (A11 §2, camada 3). A saída do modelo é NÃO-confiável. Borda: 502. */
export class SaidaLlmInvalidaError extends DomainError {
  readonly code = 'SAIDA_LLM_INVALIDA' as const;
  constructor(motivo: string) {
    super(`saída do LLM rejeitada pelo schema: ${motivo}`);
  }
}

/** Perfil de habilitação não encontrado (erro de orquestração — A10 §6). Borda: 404. */
export class PerfilNaoEncontradoError extends DomainError {
  readonly code = 'PERFIL_NAO_ENCONTRADO' as const;
  constructor(id: string) {
    super(`perfil de habilitação não encontrado: ${id}`);
  }
}
