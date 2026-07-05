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

/** Arquivo/anexo do edital indisponível para download. */
export class AnexoIndisponivelError extends DomainError {
  readonly code = 'ANEXO_INDISPONIVEL' as const;
  constructor(nome: string) {
    super(`anexo '${nome}' indisponível`);
  }
}
