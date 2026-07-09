import { DomainError } from '@radar/kernel';

/** Schema inesperado na resposta do PNCP — drift detectado. Interrompe a ingestão. */
export class SchemaDriftError extends DomainError {
  readonly code = 'SCHEMA_DRIFT' as const;
  constructor(campo: string, detalhes: string) {
    super(`schema drift no campo '${campo}': ${detalhes}`);
  }
}

/** API do PNCP indisponível ou com erro persistente após retries. */
export class FonteIndisponivelError extends DomainError {
  readonly code = 'FONTE_INDISPONIVEL' as const;
  constructor(fonte: string, causa?: string) {
    super(`fonte '${fonte}' indisponível${causa ? `: ${causa}` : ''}`);
  }
}

/** Edital não encontrado pelo identificador informado. */
export class EditalNaoEncontradoError extends DomainError {
  readonly code = 'EDITAL_NAO_ENCONTRADO' as const;
  constructor(identificador: string) {
    super(`edital não encontrado: ${identificador}`);
  }
}

/** Proveniência inválida — fonte ou baseLegal vazias, ou coletadoEm é Invalid Date. */
export class ProvenienciaInvalidaError extends DomainError {
  readonly code = 'PROVENIENCIA_INVALIDA' as const;
  constructor(campo: string) {
    super(`proveniência inválida: campo '${campo}' requer valor não-vazio ou data válida`);
  }
}

/** Arquivo/anexo do edital indisponível para download. */
export class AnexoIndisponivelError extends DomainError {
  readonly code = 'ANEXO_INDISPONIVEL' as const;
  constructor(nome: string) {
    super(`anexo '${nome}' indisponível`);
  }
}

/** Objeto ausente no storage — chave não encontrada. Lançado pelo adapter S3. */
export class ObjetoNaoEncontradoError extends DomainError {
  readonly code = 'OBJETO_NAO_ENCONTRADO' as const;
  constructor(chave: string) {
    super(`objeto não encontrado no storage: ${chave}`);
  }
}

/**
 * Tentativa de consumir anexo não-limpo (pendente ou rejeitado).
 * Fail-closed: consumidores só recebem objetos limpos (P-104, AB14).
 */
export class AnexoNaoLimpoError extends DomainError {
  readonly code = 'ANEXO_NAO_LIMPO' as const;
  constructor(nome: string, estado: string) {
    super(`anexo '${nome}' não está limpo (estado: ${estado})`);
  }
}
