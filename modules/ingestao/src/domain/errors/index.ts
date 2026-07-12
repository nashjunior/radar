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

/**
 * URL bloqueada pelo guarda SSRF antes de fazer fetch (P-58, AB7/AB8).
 * Motivo: scheme inválido, host fora da allowlist, IP privado/loopback/
 * link-local/metadata ou redirect para destino interno.
 */
export class UrlBloqueadaPorSsrfError extends DomainError {
  readonly code = 'URL_BLOQUEADA_SSRF' as const;
  constructor(url: string, motivo: string) {
    super(`URL bloqueada pelo guarda SSRF ('${url}'): ${motivo}`);
  }
}

/**
 * anoCompra/sequencialCompra ausentes ou não-positivos — chave (com cnpj) dos endpoints de
 * detalhe/arquivos do PNCP (A02 §2). Nunca deve chegar zerado numa gravação nova; só ocorre em
 * linha legada anterior a RAD-198 cujo backfill ainda não rodou (migração 004, colunas NULLABLE).
 */
export class IdentificadorCompraInvalidoError extends DomainError {
  readonly code = 'IDENTIFICADOR_COMPRA_INVALIDO' as const;
  constructor(campo: string, valor: number) {
    super(`identificador de compra inválido: '${campo}' = ${valor} (esperado > 0)`);
  }
}

/**
 * Operação rejeitada porque o circuit breaker está aberto (arq/04 §7, P-34).
 * Degradação graciosa: o chamador deve servir o estado atual sem tocar na fonte.
 */
export class BreakerAbertoError extends DomainError {
  readonly code = 'BREAKER_ABERTO' as const;
  constructor(breaker: string) {
    super(
      `circuit breaker '${breaker}' está aberto — operação rejeitada por degradação graciosa (arq/04 §7)`,
    );
  }
}

/**
 * Bytes não correspondem a um PDF/DOCX válido, ou um ZIP não contém nenhum
 * documento reconhecido dentro dele (arq/02 §6.2, P-110/RAD-279).
 */
export class ExtracaoFormatoNaoReconhecidoError extends DomainError {
  readonly code = 'EXTRACAO_FORMATO_NAO_RECONHECIDO' as const;
  constructor(detalhe: string) {
    super(`extração de texto: formato não reconhecido (${detalhe})`);
  }
}

/**
 * ZIP reprovado nas guardas de segurança antes de qualquer descompactação de
 * conteúdo — zip slip (caminho de entrada inseguro) ou zip bomb (nº de entradas,
 * razão de compressão, tamanho descompactado ou profundidade de aninhamento
 * acima do teto). Fail-closed: nunca extrai de um ZIP reprovado (arq/02 §6.2).
 */
export class ExtracaoZipInseguroError extends DomainError {
  readonly code = 'EXTRACAO_ZIP_INSEGURO' as const;
  constructor(motivo: string) {
    super(`extração de texto: zip reprovado na guarda de segurança (${motivo})`);
  }
}
