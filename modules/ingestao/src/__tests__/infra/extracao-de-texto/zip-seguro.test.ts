import { describe, expect, it } from 'vitest';
import { ExtracaoZipInseguroError } from '../../../domain/errors/index.js';
import {
  carregarZipComGuardas,
  ehPdf,
  ehZip,
  lerEntradaComTeto,
  OrcamentoDescompactacao,
  validarEntradasContraTetos,
  type EntradaZipInfo,
} from '../../../infra/adapters/extracao-de-texto/zip-seguro.js';
import { buildZip, buildZipComTamanhoMentiroso } from './fixtures.js';

const SIGNAL = new AbortController().signal;

function entrada(overrides: Partial<EntradaZipInfo>): EntradaZipInfo {
  return { nome: 'a.pdf', dir: false, ...overrides };
}

describe('validarEntradasContraTetos', () => {
  it('aceita uma lista pequena e bem comportada', () => {
    expect(() => validarEntradasContraTetos([entrada({})])).not.toThrow();
  });

  it('rejeita zip com mais entradas que o teto (200)', () => {
    const entradas = Array.from({ length: 201 }, (_, i) => entrada({ nome: `arquivo-${i}.pdf` }));
    expect(() => validarEntradasContraTetos(entradas)).toThrow(ExtracaoZipInseguroError);
  });

  it('aceita entradas de diretório', () => {
    expect(() => validarEntradasContraTetos([entrada({ nome: 'dir/', dir: true })])).not.toThrow();
  });

  // Zip slip (arq/02 §6.2): nunca confiar no caminho interno da entrada.
  it.each([
    ['../../etc/passwd'],
    ['/etc/passwd'],
    ['C:\\Windows\\system32\\evil.dll'],
    ['pasta/../../../fora-do-zip.txt'],
    ['\\..\\..\\evil.txt'],
  ])('rejeita entrada com caminho inseguro: %s', (nomeMalicioso) => {
    expect(() => validarEntradasContraTetos([entrada({ nome: nomeMalicioso })])).toThrow(ExtracaoZipInseguroError);
  });

  it('aceita caminho relativo normal (subpasta legítima)', () => {
    expect(() => validarEntradasContraTetos([entrada({ nome: 'word/document.xml' })])).not.toThrow();
  });
});

describe('carregarZipComGuardas', () => {
  it('carrega um zip válido e pequeno', async () => {
    const bytes = await buildZip({ 'a.txt': new TextEncoder().encode('ola') });
    const zip = await carregarZipComGuardas(bytes, SIGNAL);
    expect(Object.keys(zip.files)).toContain('a.txt');
  });

  it('rejeita bytes corrompidos/ilegíveis como zip', async () => {
    const lixo = new Uint8Array([1, 2, 3, 4, 5]);
    await expect(carregarZipComGuardas(lixo, SIGNAL)).rejects.toThrow(ExtracaoZipInseguroError);
  });

  it('propaga abort via AbortSignal', async () => {
    const controller = new AbortController();
    controller.abort();
    const bytes = await buildZip({ 'a.txt': new TextEncoder().encode('ola') });
    await expect(carregarZipComGuardas(bytes, controller.signal)).rejects.toThrow();
  });
});

describe('OrcamentoDescompactacao', () => {
  it('não está excedido enquanto o consumo acumulado fica dentro do limite', () => {
    const orcamento = new OrcamentoDescompactacao(1000);
    orcamento.consumir(400);
    orcamento.consumir(400);
    expect(orcamento.excedido()).toBe(false);
  });

  it('fica excedido assim que o consumo acumulado passa do limite', () => {
    const orcamento = new OrcamentoDescompactacao(1000);
    orcamento.consumir(600);
    orcamento.consumir(500);
    expect(orcamento.excedido()).toBe(true);
  });
});

describe('lerEntradaComTeto', () => {
  it('lê o conteúdo real de uma entrada pequena e bem comportada', async () => {
    const bytes = await buildZip({ 'a.txt': new TextEncoder().encode('conteudo real') });
    const zip = await carregarZipComGuardas(bytes, SIGNAL);
    const entry = zip.files['a.txt']!;

    const lido = await lerEntradaComTeto(entry, new OrcamentoDescompactacao(), SIGNAL);

    expect(new TextDecoder().decode(lido)).toBe('conteudo real');
  });

  // Achado da revisão de segurança do RAD-279: uma guarda que confia no
  // `uncompressedSize` declarado no header do zip é contornável — o atacante
  // escreve um valor pequeno ali e o payload deflate real continua enorme.
  // A defesa correta mede bytes conforme saem da descompactação REAL.
  it('rejeita um zip bomb com header mentiroso (tamanho declarado pequeno, conteúdo real gigante)', async () => {
    const TAMANHO_REAL = 30 * 1024 * 1024; // 30 MB reais
    const bytes = await buildZipComTamanhoMentiroso('bomb.bin', TAMANHO_REAL, 50); // declara só 50 bytes
    const zip = await carregarZipComGuardas(bytes, SIGNAL); // passa — nº de entradas e caminho estão OK
    const entry = zip.files['bomb.bin']!;

    // Orçamento pequeno de propósito para o teste ser rápido — o ponto não é o
    // valor exato do teto de produção (200 MB), é provar que o header mentiroso
    // não engana o orçamento: o real streamado é o que conta.
    const orcamentoPequeno = new OrcamentoDescompactacao(1024 * 1024); // 1 MB
    await expect(lerEntradaComTeto(entry, orcamentoPequeno, SIGNAL)).rejects.toThrow(ExtracaoZipInseguroError);
  }, 20_000);

  it('soma ao orçamento compartilhado mesmo quando a entrada individual está dentro do teto por arquivo', async () => {
    const bytes = await buildZip({ 'a.txt': new TextEncoder().encode('x'.repeat(1000)) });
    const zip = await carregarZipComGuardas(bytes, SIGNAL);
    const entry = zip.files['a.txt']!;

    const orcamentoMinusculo = new OrcamentoDescompactacao(10); // bem menor que 1000 bytes reais
    await expect(lerEntradaComTeto(entry, orcamentoMinusculo, SIGNAL)).rejects.toThrow(ExtracaoZipInseguroError);
  });

  it('propaga abort via AbortSignal antes de começar', async () => {
    const controller = new AbortController();
    controller.abort();
    const bytes = await buildZip({ 'a.txt': new TextEncoder().encode('x') });
    const zip = await carregarZipComGuardas(bytes, SIGNAL);
    const entry = zip.files['a.txt']!;

    await expect(lerEntradaComTeto(entry, new OrcamentoDescompactacao(), controller.signal)).rejects.toThrow();
  });
});

describe('sniff de magic bytes', () => {
  it('ehPdf reconhece o cabeçalho %PDF-', () => {
    expect(ehPdf(new TextEncoder().encode('%PDF-1.7 resto'))).toBe(true);
    expect(ehPdf(new TextEncoder().encode('nao e pdf'))).toBe(false);
  });

  it('ehZip reconhece o cabeçalho PK\\x03\\x04', () => {
    expect(ehZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]))).toBe(true);
    expect(ehZip(new Uint8Array([0x00, 0x00, 0x00, 0x00]))).toBe(false);
  });
});
