import type JSZip from 'jszip';
import { ExtracaoFormatoNaoReconhecidoError } from '../../../domain/errors/index.js';
import type { ResultadoExtracao } from '../../../application/ports.js';
import { lerEntradaComTeto, type OrcamentoDescompactacao } from './zip-seguro.js';

// Word grava <Pages> em docProps/app.xml com a contagem da última repaginação
// (atualizada ao salvar) — é o valor mais próximo de "real" sem um motor de
// layout completo. Ausente (raro) ⇒ estimativa por volume de texto, nunca 1
// fixo (a citação `p. N` da triagem não pode virar fictícia, arq/02 §6.2).
const CARACTERES_POR_PAGINA_ESTIMADOS = 3000;

// `(?:\s[^>]*)?` — a fronteira depois de "w:t" tem que ser espaço ou '>', nunca
// outra letra; sem isso, `[^>]*` genérico batia também em `<w:tab/>` (bug real,
// achado pelo teste desta mesma extração: "tab/" satisfaz `[^>]*`).
const REGEX_TOKEN_TEXTO = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<\/w:p>/g;

function decodificarEntidadesXml(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

/** Extrai o texto corrido de `word/document.xml` — sem parser XML completo (fora
 * do escopo: só precisamos do texto, não da estrutura/formatação). */
export function extrairTextoDeDocumentXml(xml: string): string {
  let texto = '';
  for (const match of xml.matchAll(REGEX_TOKEN_TEXTO)) {
    if (match[1] !== undefined) {
      texto += decodificarEntidadesXml(match[1]);
    } else if (match[0] === '<w:tab/>') {
      texto += '\t';
    } else {
      texto += '\n';
    }
  }
  return texto.trim();
}

/** Lê uma entrada de texto do zip sob o mesmo teto de bytes usado no resto do
 * extrator (arq/02 §6.2) — `word/document.xml`/`docProps/app.xml` também são
 * conteúdo comprimido dentro do zip, não estão isentos de zip bomb. */
async function lerEntradaDeTexto(
  zip: JSZip,
  caminho: string,
  orcamento: OrcamentoDescompactacao,
  signal: AbortSignal,
): Promise<string | undefined> {
  const entry = zip.file(caminho);
  if (entry === null) return undefined;
  const bytes = await lerEntradaComTeto(entry, orcamento, signal);
  return new TextDecoder('utf-8').decode(bytes);
}

async function resolverPaginas(
  zip: JSZip,
  totalCaracteres: number,
  orcamento: OrcamentoDescompactacao,
  signal: AbortSignal,
): Promise<number> {
  const appXml = await lerEntradaDeTexto(zip, 'docProps/app.xml', orcamento, signal);
  if (appXml) {
    const match = /<Pages>(\d+)<\/Pages>/.exec(appXml);
    const paginas = match ? parseInt(match[1]!, 10) : 0;
    if (paginas > 0) return paginas;
  }
  return Math.max(1, Math.ceil(totalCaracteres / CARACTERES_POR_PAGINA_ESTIMADOS));
}

/** Extrai texto+páginas de um DOCX já carregado como `JSZip` (docx é um zip por
 * dentro — quem decide se um zip é docx é o chamador, ao achar `word/document.xml`).
 * `orcamento` é o mesmo teto de bytes descompactados de toda a extração (arq/02 §6.2). */
export async function extrairDocx(
  zip: JSZip,
  signal: AbortSignal,
  orcamento: OrcamentoDescompactacao,
): Promise<ResultadoExtracao> {
  signal.throwIfAborted();
  const documentoXml = await lerEntradaDeTexto(zip, 'word/document.xml', orcamento, signal);
  if (documentoXml === undefined) {
    throw new ExtracaoFormatoNaoReconhecidoError("docx sem 'word/document.xml'");
  }

  const texto = extrairTextoDeDocumentXml(documentoXml);
  const paginas = await resolverPaginas(zip, texto.length, orcamento, signal);

  return { texto, paginas, temTextoSelecionavel: texto.length > 0 };
}
