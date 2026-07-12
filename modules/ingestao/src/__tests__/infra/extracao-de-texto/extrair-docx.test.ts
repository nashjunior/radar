import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ExtracaoFormatoNaoReconhecidoError } from '../../../domain/errors/index.js';
import {
  extrairDocx,
  extrairTextoDeDocumentXml,
} from '../../../infra/adapters/extracao-de-texto/extrair-docx.js';
import { OrcamentoDescompactacao } from '../../../infra/adapters/extracao-de-texto/zip-seguro.js';
import { buildDocx } from './fixtures.js';

const SIGNAL = new AbortController().signal;

function novoOrcamento(): OrcamentoDescompactacao {
  return new OrcamentoDescompactacao();
}

describe('extrairTextoDeDocumentXml', () => {
  it('extrai texto de runs simples, com quebra de parágrafo virando \\n', () => {
    const xml = `<w:document><w:body>
      <w:p><w:r><w:t>Primeiro paragrafo</w:t></w:r></w:p>
      <w:p><w:r><w:t>Segundo paragrafo</w:t></w:r></w:p>
    </w:body></w:document>`;
    expect(extrairTextoDeDocumentXml(xml)).toBe('Primeiro paragrafo\nSegundo paragrafo');
  });

  it('decodifica entidades XML (&amp; &lt; &gt; &quot; &apos;)', () => {
    const xml = `<w:p><w:r><w:t>A &amp; B &lt;tag&gt; &quot;citado&quot; &apos;ok&apos;</w:t></w:r></w:p>`;
    expect(extrairTextoDeDocumentXml(xml)).toBe(`A & B <tag> "citado" 'ok'`);
  });

  it('converte <w:tab/> em tab e <w:br/> em quebra de linha', () => {
    const xml = `<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>`;
    expect(extrairTextoDeDocumentXml(xml)).toBe('a\tb\nc');
  });

  it('preserva espaço com xml:space="preserve"', () => {
    const xml = `<w:p><w:r><w:t>antes</w:t><w:t xml:space="preserve"> com espaco </w:t><w:t>depois</w:t></w:r></w:p>`;
    expect(extrairTextoDeDocumentXml(xml)).toBe('antes com espaco depois');
  });

  it('devolve string vazia para documento sem nenhum <w:t>', () => {
    expect(extrairTextoDeDocumentXml('<w:document><w:body></w:body></w:document>')).toBe('');
  });
});

describe('extrairDocx', () => {
  it('extrai texto e usa <Pages> de docProps/app.xml quando presente (nº real do Word)', async () => {
    const bytes = await buildDocx(['Edital de Pregao', 'Item 1: fornecimento de bens'], { paginasDeclaradas: 7 });
    const zip = await JSZip.loadAsync(bytes);

    const resultado = await extrairDocx(zip, SIGNAL, novoOrcamento());

    expect(resultado.texto).toBe('Edital de Pregao\nItem 1: fornecimento de bens');
    expect(resultado.paginas).toBe(7);
    expect(resultado.temTextoSelecionavel).toBe(true);
  });

  it('estima páginas por volume de texto quando docProps/app.xml está ausente — nunca hardcoded em 1', async () => {
    const paragrafoLongo = 'lorem ipsum '.repeat(500); // ~6000 caracteres ⇒ > 1 página estimada
    const bytes = await buildDocx([paragrafoLongo]);
    const zip = await JSZip.loadAsync(bytes);

    const resultado = await extrairDocx(zip, SIGNAL, novoOrcamento());

    expect(resultado.paginas).toBeGreaterThan(1);
  });

  it('estimativa por volume nunca cai abaixo de 1 página para texto curto', async () => {
    const bytes = await buildDocx(['oi']);
    const zip = await JSZip.loadAsync(bytes);

    const resultado = await extrairDocx(zip, SIGNAL, novoOrcamento());

    expect(resultado.paginas).toBe(1);
  });

  it('lança ExtracaoFormatoNaoReconhecidoError se o zip não tem word/document.xml', async () => {
    const zip = new JSZip();
    zip.file('outro-arquivo.xml', '<xml/>');
    await expect(extrairDocx(zip, SIGNAL, novoOrcamento())).rejects.toThrow(ExtracaoFormatoNaoReconhecidoError);
  });
});
