import { ExtracaoFormatoNaoReconhecidoError, ExtracaoZipInseguroError } from '../../../domain/errors/index.js';
import type { ExtratorDeTexto, ResultadoExtracao } from '../../../application/ports.js';
import { extrairDocx } from './extrair-docx.js';
import { extrairPdf } from './extrair-pdf.js';
import {
  carregarZipComGuardas,
  ehPdf,
  ehZip,
  lerEntradaComTeto,
  MAX_PROFUNDIDADE_ANINHAMENTO,
  OrcamentoDescompactacao,
} from './zip-seguro.js';

function combinarResultados(resultados: ResultadoExtracao[]): ResultadoExtracao {
  return {
    texto: resultados.map((r) => r.texto).filter((t) => t.length > 0).join('\n\n'),
    paginas: resultados.reduce((soma, r) => soma + r.paginas, 0),
    temTextoSelecionavel: resultados.some((r) => r.temTextoSelecionavel),
  };
}

async function processarZip(
  bytes: Uint8Array,
  signal: AbortSignal,
  profundidade: number,
  orcamento: OrcamentoDescompactacao,
): Promise<ResultadoExtracao> {
  if (profundidade > MAX_PROFUNDIDADE_ANINHAMENTO) {
    throw new ExtracaoZipInseguroError(
      `profundidade de aninhamento excede o limite (${MAX_PROFUNDIDADE_ANINHAMENTO})`,
    );
  }

  const zip = await carregarZipComGuardas(bytes, signal);

  // DOCX é um zip por dentro — se tem `word/document.xml`, é um DOCX, não um
  // container genérico (arq/02 §6.2; magic bytes sozinhos não distinguem os dois).
  if (zip.files['word/document.xml']) {
    return extrairDocx(zip, signal, orcamento);
  }

  const resultados: ResultadoExtracao[] = [];
  for (const nome of Object.keys(zip.files).sort()) {
    signal.throwIfAborted();
    const entry = zip.files[nome]!;
    if (entry.dir) continue;

    const conteudo = await lerEntradaComTeto(entry, orcamento, signal);
    if (ehPdf(conteudo)) {
      resultados.push(await extrairPdf(conteudo, signal));
    } else if (ehZip(conteudo)) {
      resultados.push(await processarZip(conteudo, signal, profundidade + 1, orcamento));
    }
    // Entrada não reconhecida (planilha, imagem solta, etc.) — ignorada, não é erro.
  }

  if (resultados.length === 0) {
    throw new ExtracaoFormatoNaoReconhecidoError('zip sem nenhum PDF/DOCX/ZIP reconhecido dentro dele');
  }

  return combinarResultados(resultados);
}

/**
 * Adapter multi-formato do port `ExtratorDeTexto` (arq/02 §6.2–§6.3, P-110/RAD-279).
 * PDF via `pdfjs-dist`; DOCX e ZIP-contendo-os via `jszip`, com guardas de zip
 * slip (caminho da entrada) e zip bomb (nº de entradas, profundidade de
 * aninhamento e um orçamento de bytes descompactados medido na descompactação
 * REAL — nunca no tamanho declarado no header do zip, que é metadado do
 * próprio atacante e não faz parte da defesa, arq/02 §6.2) aplicadas antes/
 * durante qualquer descompactação de conteúdo.
 *
 * O `mime` recebido já vem sniffado por magic bytes na borda de download
 * (`ExtensaoAnexo`/`pncp-http-gateway`, RAD-278) — só distingue PDF de ZIP; a
 * diferença entre DOCX e ZIP-container só é resolvida aqui, olhando o conteúdo.
 */
export class MultiFormatoExtratorDeTexto implements ExtratorDeTexto {
  async extrair(bytes: Uint8Array, mime: string, signal: AbortSignal): Promise<ResultadoExtracao> {
    signal.throwIfAborted();

    if (mime === 'application/pdf') {
      return extrairPdf(bytes, signal);
    }
    if (mime === 'application/zip') {
      return processarZip(bytes, signal, 0, new OrcamentoDescompactacao());
    }
    throw new ExtracaoFormatoNaoReconhecidoError(`mime não suportado: '${mime}'`);
  }
}
