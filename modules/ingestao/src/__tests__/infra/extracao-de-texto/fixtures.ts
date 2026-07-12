import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

/** PDF real (via pdf-lib) com uma página por string de texto — texto selecionável. */
export async function buildPdfComTexto(textosPorPagina: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const texto of textosPorPagina) {
    const pagina = doc.addPage([300, 300]);
    pagina.drawText(texto, { x: 20, y: 200, size: 16, font });
  }
  return doc.save();
}

/** PDF real sem nenhum objeto de texto (só um retângulo) — simula PDF escaneado/imagem. */
export async function buildPdfSemTexto(paginas = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < paginas; i++) {
    const pagina = doc.addPage([300, 300]);
    pagina.drawRectangle({ x: 0, y: 0, width: 300, height: 300, color: rgb(0.5, 0.5, 0.5) });
  }
  return doc.save();
}

export interface DocxOpts {
  paginasDeclaradas?: number;
}

/** DOCX mínimo válido (mão, sem lib) — `[Content_Types].xml` + `word/document.xml` +
 * opcionalmente `docProps/app.xml` com `<Pages>` (o que o Word grava ao salvar). */
export async function buildDocx(paragrafos: string[], opts: DocxOpts = {}): Promise<Uint8Array> {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const corpo = paragrafos.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${corpo}</w:body>
</w:document>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('word/document.xml', documentXml);
  if (opts.paginasDeclaradas !== undefined) {
    const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
<Pages>${opts.paginasDeclaradas}</Pages>
</Properties>`;
    zip.file('docProps/app.xml', appXml);
  }
  return zip.generateAsync({ type: 'uint8array' });
}

/** Container ZIP genérico com as entradas dadas (nome → bytes). */
export async function buildZip(entradas: Record<string, Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [nome, conteudo] of Object.entries(entradas)) {
    zip.file(nome, conteudo, { compression: 'DEFLATE' });
  }
  return zip.generateAsync({ type: 'uint8array' });
}

/** Zip bomb: um bloco de zeros altamente compressível — razão de compressão >> teto. */
export async function buildZipBomb(tamanhoDescompactado = 2 * 1024 * 1024): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('bomb.bin', new Uint8Array(tamanhoDescompactado), { compression: 'DEFLATE' });
  return zip.generateAsync({ type: 'uint8array' });
}

function le32(n: number): Uint8Array {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setUint32(0, n, true);
  return buf;
}

/**
 * Zip bomb com header MENTIROSO: `uncompressedSize` declarado no local/central
 * directory é sobrescrito para um valor pequeno, mas o payload deflate real
 * continua sendo `tamanhoReal` — exatamente o vetor que engana qualquer guarda
 * baseada em metadado declarado (PoC do achado de segurança do RAD-279: um
 * header mentiroso passa incólume por checagem que confia em `_data`/header;
 * só a descompactação real, medida byte a byte, pega isso).
 */
export async function buildZipComTamanhoMentiroso(
  nomeEntrada: string,
  tamanhoReal: number,
  tamanhoDeclarado: number,
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(nomeEntrada, new Uint8Array(tamanhoReal), { compression: 'DEFLATE' });
  const gerado = await zip.generateAsync({ type: 'uint8array' });

  const buf = Buffer.from(gerado.buffer, gerado.byteOffset, gerado.byteLength);
  const real = Buffer.from(le32(tamanhoReal));
  const mentira = Buffer.from(le32(tamanhoDeclarado));

  let idx = buf.indexOf(real);
  while (idx !== -1) {
    mentira.copy(buf, idx);
    idx = buf.indexOf(real, idx + 4);
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
