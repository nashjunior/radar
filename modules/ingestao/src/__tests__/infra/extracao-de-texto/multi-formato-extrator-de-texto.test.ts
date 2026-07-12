import { describe, expect, it } from 'vitest';
import { ExtracaoFormatoNaoReconhecidoError, ExtracaoZipInseguroError } from '../../../domain/errors/index.js';
import { MultiFormatoExtratorDeTexto } from '../../../infra/adapters/extracao-de-texto/multi-formato-extrator-de-texto.js';
import { buildDocx, buildPdfComTexto, buildPdfSemTexto, buildZip, buildZipComTamanhoMentiroso } from './fixtures.js';

const SIGNAL = new AbortController().signal;

describe('MultiFormatoExtratorDeTexto', () => {
  const extrator = new MultiFormatoExtratorDeTexto();

  describe('PDF', () => {
    it('extrai texto real e número real de páginas de um PDF com texto selecionável', async () => {
      const bytes = await buildPdfComTexto(['Pagina um do edital', 'Pagina dois do edital']);

      const resultado = await extrator.extrair(bytes, 'application/pdf', SIGNAL);

      expect(resultado.paginas).toBe(2);
      expect(resultado.temTextoSelecionavel).toBe(true);
      expect(resultado.texto).toContain('Pagina um do edital');
      expect(resultado.texto).toContain('Pagina dois do edital');
    });

    it('devolve temTextoSelecionavel:false e texto vazio para PDF sem texto (escaneado) — sem OCR no MVP', async () => {
      const bytes = await buildPdfSemTexto(3);

      const resultado = await extrator.extrair(bytes, 'application/pdf', SIGNAL);

      expect(resultado.paginas).toBe(3);
      expect(resultado.temTextoSelecionavel).toBe(false);
      expect(resultado.texto).toBe('');
    });

    it('lança ExtracaoFormatoNaoReconhecidoError para PDF corrompido', async () => {
      const bytes = new TextEncoder().encode('%PDF-1.7 mas o resto e lixo');
      await expect(extrator.extrair(bytes, 'application/pdf', SIGNAL)).rejects.toThrow(
        ExtracaoFormatoNaoReconhecidoError,
      );
    });
  });

  describe('DOCX (mime application/zip contendo word/document.xml)', () => {
    it('detecta DOCX pelo conteúdo e extrai texto + páginas reais do docProps/app.xml', async () => {
      const bytes = await buildDocx(['Edital de Pregao Eletronico'], { paginasDeclaradas: 5 });

      const resultado = await extrator.extrair(bytes, 'application/zip', SIGNAL);

      expect(resultado.paginas).toBe(5);
      expect(resultado.temTextoSelecionavel).toBe(true);
      expect(resultado.texto).toBe('Edital de Pregao Eletronico');
    });
  });

  describe('ZIP container (mime application/zip, edital embrulhado em zip — 15% da amostra RAD-274)', () => {
    it('extrai o PDF de dentro de um ZIP container', async () => {
      const pdfBytes = await buildPdfComTexto(['Objeto da licitacao']);
      const zipBytes = await buildZip({ 'Edital.pdf': pdfBytes });

      const resultado = await extrator.extrair(zipBytes, 'application/zip', SIGNAL);

      expect(resultado.paginas).toBe(1);
      expect(resultado.temTextoSelecionavel).toBe(true);
      expect(resultado.texto).toContain('Objeto da licitacao');
    });

    it('combina texto e soma páginas de múltiplos documentos reconhecidos dentro do zip', async () => {
      const pdfBytes = await buildPdfComTexto(['Texto do PDF']);
      const docxBytes = await buildDocx(['Texto do DOCX'], { paginasDeclaradas: 2 });
      const zipBytes = await buildZip({ 'edital.pdf': pdfBytes, 'anexo.docx': docxBytes });

      const resultado = await extrator.extrair(zipBytes, 'application/zip', SIGNAL);

      expect(resultado.paginas).toBe(3); // 1 (pdf) + 2 (docx)
      expect(resultado.temTextoSelecionavel).toBe(true);
      expect(resultado.texto).toContain('Texto do PDF');
      expect(resultado.texto).toContain('Texto do DOCX');
    });

    it('temTextoSelecionavel é true se ao menos um documento do zip tiver texto (OR, não AND)', async () => {
      const pdfEscaneado = await buildPdfSemTexto(1);
      const pdfComTexto = await buildPdfComTexto(['Achei o texto']);
      const zipBytes = await buildZip({ 'escaneado.pdf': pdfEscaneado, 'com-texto.pdf': pdfComTexto });

      const resultado = await extrator.extrair(zipBytes, 'application/zip', SIGNAL);

      expect(resultado.temTextoSelecionavel).toBe(true);
      expect(resultado.texto).toBe('Achei o texto');
    });

    it('extrai de um zip aninhado dentro de outro zip até a profundidade permitida (3)', async () => {
      const pdfBytes = await buildPdfComTexto(['fundo do poco']);
      let bytes = await buildZip({ 'doc.pdf': pdfBytes });
      bytes = await buildZip({ 'inner.zip': bytes }); // profundidade 3 (permitida)
      bytes = await buildZip({ 'inner.zip': bytes }); // profundidade 2
      bytes = await buildZip({ 'inner.zip': bytes }); // profundidade 1 → topo = profundidade 0

      const resultado = await extrator.extrair(bytes, 'application/zip', SIGNAL);

      expect(resultado.texto).toContain('fundo do poco');
    });

    it('rejeita zip aninhado além da profundidade máxima (zip bomb via aninhamento)', async () => {
      let bytes = await buildZip({}); // profundidade 4 (além do limite)
      bytes = await buildZip({ 'inner.zip': bytes }); // 3
      bytes = await buildZip({ 'inner.zip': bytes }); // 2
      bytes = await buildZip({ 'inner.zip': bytes }); // 1
      bytes = await buildZip({ 'inner.zip': bytes }); // topo = 0

      await expect(extrator.extrair(bytes, 'application/zip', SIGNAL)).rejects.toThrow(ExtracaoZipInseguroError);
    });

    it('lança ExtracaoFormatoNaoReconhecidoError quando o zip não contém nenhum PDF/DOCX/ZIP', async () => {
      const zipBytes = await buildZip({ 'planilha.csv': new TextEncoder().encode('a,b,c\n1,2,3') });
      await expect(extrator.extrair(zipBytes, 'application/zip', SIGNAL)).rejects.toThrow(
        ExtracaoFormatoNaoReconhecidoError,
      );
    });
  });

  describe('zip bomb com header mentiroso (regressão do achado de segurança do RAD-279)', () => {
    it('rejeita via API pública mesmo quando o header do zip mente sobre o tamanho descompactado', async () => {
      const TAMANHO_REAL = 210 * 1024 * 1024; // > teto de produção de 200 MB por arquivo
      const bytes = await buildZipComTamanhoMentiroso('bomb.bin', TAMANHO_REAL, 100); // declara só 100 bytes

      await expect(extrator.extrair(bytes, 'application/zip', SIGNAL)).rejects.toThrow(ExtracaoZipInseguroError);
    }, 30_000);
  });

  describe('mime não suportado', () => {
    it('lança ExtracaoFormatoNaoReconhecidoError para mime fora de pdf/zip', async () => {
      await expect(
        extrator.extrair(new Uint8Array([1, 2, 3]), 'application/octet-stream', SIGNAL),
      ).rejects.toThrow(ExtracaoFormatoNaoReconhecidoError);
    });
  });

  describe('AbortSignal (P-78)', () => {
    it('rejeita imediatamente se o signal já está abortado', async () => {
      const controller = new AbortController();
      controller.abort();
      const bytes = await buildPdfComTexto(['x']);
      await expect(extrator.extrair(bytes, 'application/pdf', controller.signal)).rejects.toThrow();
    });
  });
});
