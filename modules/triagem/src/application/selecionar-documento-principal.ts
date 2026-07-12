import type { ArquivoRef } from './ports.js';

/** Valores do contrato publicado pelo Open-Host da Ingestão (arq/02 §6.1, P-110/RAD-280). */
const TIPO_DOCUMENTO_EDITAL = 2;
const TIPO_DOCUMENTO_TERMO_REFERENCIA = 4;

function porMenorSequencial(arquivos: readonly ArquivoRef[]): ArquivoRef | undefined {
  return arquivos.reduce<ArquivoRef | undefined>(
    (menor, atual) =>
      menor === undefined || atual.sequencialDocumento < menor.sequencialDocumento ? atual : menor,
    undefined,
  );
}

export interface DocumentoPrincipalSelecionado {
  readonly principal: ArquivoRef | undefined;
  readonly demais: readonly ArquivoRef[];
}

/**
 * "O edital" nunca é `arquivos[0]` — a ordem do array é arbitrária (vem do banco/PNCP sem
 * garantia de ordem; na amostra real o `[0]` era um Parecer Contábil, P-110). Seleciona por
 * `tipoDocumentoId`: Edital (2); sem Edital, o Termo de Referência (4); sem nenhum dos dois,
 * o documento de menor `sequencialDocumento` — piso determinístico, nunca posição no array.
 */
export function selecionarDocumentoPrincipal(
  arquivos: readonly ArquivoRef[],
): DocumentoPrincipalSelecionado {
  const editais = arquivos.filter((a) => a.tipoDocumentoId === TIPO_DOCUMENTO_EDITAL);
  const termosDeReferencia = arquivos.filter((a) => a.tipoDocumentoId === TIPO_DOCUMENTO_TERMO_REFERENCIA);
  const principal =
    porMenorSequencial(editais) ?? porMenorSequencial(termosDeReferencia) ?? porMenorSequencial(arquivos);
  const demais = arquivos.filter((a) => a !== principal);
  return { principal, demais };
}
