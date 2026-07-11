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

/**
 * O modelo RECUSOU a extração (`stop_reason: "refusal"` — classificador de segurança ou recusa do
 * próprio modelo). Em recusa o `content` vem vazio/parcial: NUNCA fabricar extração — degradar para
 * leitura manual, como no OCR que falha (docs/10 §6). Distinto de `SaidaLlmInvalidaError` (schema
 * inválido = falha do provedor, 502): a recusa não é lixo, é o modelo declinando. Borda: 422.
 */
export class ExtracaoRecusadaError extends DomainError {
  readonly code = 'EXTRACAO_RECUSADA' as const;
  constructor() {
    super('modelo recusou a extração — marcar "requer leitura manual"');
  }
}

/**
 * Transporte de extração em LOTE indisponível (A17 §7, RAD-54): o poll do batch não concluiu no teto
 * de verificações, ou a operação foi abortada (P-78). Falha de transporte, não de conteúdo — o lote é
 * assíncrono e retryável (P-45). Borda: 503.
 */
export class LoteExtracaoIndisponivelError extends DomainError {
  readonly code = 'LOTE_EXTRACAO_INDISPONIVEL' as const;
  constructor(motivo: string) {
    super(`extração em lote indisponível: ${motivo}`);
  }
}

/** Perfil de habilitação não encontrado (erro de orquestração — A10 §6). Borda: 404. */
export class PerfilNaoEncontradoError extends DomainError {
  readonly code = 'PERFIL_NAO_ENCONTRADO' as const;
  constructor(id: string) {
    super(`perfil de habilitação não encontrado: ${id}`);
  }
}

/** Triagem não encontrada para o par edital+perfil — feedback solicitado antes da triagem existir. Borda: 404. */
export class TriagemNaoEncontradaError extends DomainError {
  readonly code = 'TRIAGEM_NAO_ENCONTRADA' as const;
  constructor(editalId: string, perfilId: string) {
    super(`Triagem não encontrada: editalId=${editalId}, perfilId=${perfilId}`);
  }
}
