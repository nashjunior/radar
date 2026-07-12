import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { ExtracaoFormatoNaoReconhecidoError } from '../../../domain/errors/index.js';
import type { ResultadoExtracao } from '../../../application/ports.js';

/**
 * Extrai texto de um PDF com `pdfjs-dist` (build legacy, sem canvas — só o
 * parsing de estrutura/texto, sem rasterização). `paginas` é o `numPages` real
 * do documento; PDF escaneado (sem texto no layer) devolve `temTextoSelecionavel:
 * false` e `texto: ''` — sem OCR no MVP (docs/10 §6), a triagem degrada em vez
 * de alucinar.
 */
export async function extrairPdf(bytes: Uint8Array, signal: AbortSignal): Promise<ResultadoExtracao> {
  signal.throwIfAborted();

  const task = getDocument({ data: bytes, useSystemFonts: true });
  let documento;
  try {
    documento = await task.promise;
  } catch {
    throw new ExtracaoFormatoNaoReconhecidoError('pdf inválido ou corrompido');
  }

  try {
    const paginas = documento.numPages;
    const textosPorPagina: string[] = [];
    let temTextoSelecionavel = false;

    for (let numero = 1; numero <= paginas; numero++) {
      signal.throwIfAborted();
      const pagina = await documento.getPage(numero);
      const conteudo = await pagina.getTextContent();
      const textoPagina = conteudo.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();

      if (textoPagina.length > 0) temTextoSelecionavel = true;
      textosPorPagina.push(textoPagina);
    }

    return {
      texto: temTextoSelecionavel ? textosPorPagina.join('\n\n') : '',
      paginas,
      temTextoSelecionavel,
    };
  } finally {
    await documento.destroy();
  }
}
