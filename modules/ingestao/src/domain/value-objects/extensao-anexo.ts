import { DomainError } from '@radar/kernel';

/** Sniff de magic bytes retornou mime fora da allowlist — chave não pode sair do título (RAD-278). */
export class AnexoFormatoNaoSuportadoError extends DomainError {
  readonly code = 'ANEXO_FORMATO_NAO_SUPORTADO' as const;
  constructor(tipoMime: string) {
    super(`formato de anexo não suportado: '${tipoMime}'`);
  }
}

const EXTENSAO_POR_MIME: Readonly<Record<string, string>> = {
  'application/pdf': 'pdf',
  // DOCX é um ZIP por dentro — magic bytes não distinguem os dois (P-110); o
  // extrator multi-formato (RAD-279) resolve a diferença a partir do conteúdo.
  'application/zip': 'zip',
};

/**
 * VO imutável: extensão de anexo derivada só do mime sniffado por magic bytes
 * (nunca do nome/título digitado pelo órgão — dado não confiável, RAD-278).
 */
export class ExtensaoAnexo {
  private constructor(readonly valor: string) {}

  static criar(tipoMimeSniffado: string): ExtensaoAnexo {
    const ext = EXTENSAO_POR_MIME[tipoMimeSniffado];
    if (!ext) throw new AnexoFormatoNaoSuportadoError(tipoMimeSniffado);
    return new ExtensaoAnexo(ext);
  }

  equals(other: ExtensaoAnexo): boolean {
    return this.valor === other.valor;
  }

  toString(): string {
    return this.valor;
  }
}
