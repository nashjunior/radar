import { describe, expect, it } from 'vitest';
import { selecionarDocumentoPrincipal } from '../../application/selecionar-documento-principal.js';
import type { ArquivoRef } from '../../application/ports.js';

function arquivo(seq: number, tipoDocumentoId: number, tipoDocumentoNome: string): ArquivoRef {
  return {
    nome: `arquivo-${seq}.pdf`,
    storageKey: `storage-${seq}`,
    tipoMime: 'application/pdf',
    sequencialDocumento: seq,
    tipoDocumentoId,
    tipoDocumentoNome,
    textoKey: `texto-key-${seq}`,
    paginas: seq,
  };
}

describe('selecionarDocumentoPrincipal', () => {
  it('array vazio: sem principal, sem demais', () => {
    const { principal, demais } = selecionarDocumentoPrincipal([]);

    expect(principal).toBeUndefined();
    expect(demais).toEqual([]);
  });

  it('seleciona o Edital (tipoDocumentoId 2) mesmo fora da posição 0 — bug real (P-110)', () => {
    const parecerContabil = arquivo(1, 16, 'Outros Documentos');
    const edital = arquivo(2, 2, 'Edital');
    const { principal, demais } = selecionarDocumentoPrincipal([parecerContabil, edital]);

    expect(principal).toBe(edital);
    expect(demais).toEqual([parecerContabil]);
  });

  it('sem Edital: cai para o Termo de Referência (tipoDocumentoId 4)', () => {
    const outros = arquivo(1, 16, 'Outros Documentos');
    const termoReferencia = arquivo(2, 4, 'Termo de Referência');
    const { principal, demais } = selecionarDocumentoPrincipal([outros, termoReferencia]);

    expect(principal).toBe(termoReferencia);
    expect(demais).toEqual([outros]);
  });

  it('múltiplos Editais: desempate pelo menor sequencialDocumento', () => {
    const edital2 = arquivo(2, 2, 'Edital');
    const edital1 = arquivo(1, 2, 'Edital');
    const { principal } = selecionarDocumentoPrincipal([edital2, edital1]);

    expect(principal).toBe(edital1);
  });

  it('sem Edital nem Termo de Referência: cai para o menor sequencialDocumento entre todos', () => {
    const outros5 = arquivo(5, 16, 'Outros Documentos');
    const outros3 = arquivo(3, 7, 'Estudo Técnico Preliminar');
    const { principal, demais } = selecionarDocumentoPrincipal([outros5, outros3]);

    expect(principal).toBe(outros3);
    expect(demais).toEqual([outros5]);
  });

  it('nunca escolhe por posição — array[0] não é o Edital', () => {
    const primeiro = arquivo(1, 16, 'Outros Documentos');
    const segundo = arquivo(2, 16, 'Outros Documentos');
    const edital = arquivo(3, 2, 'Edital');
    const { principal } = selecionarDocumentoPrincipal([primeiro, segundo, edital]);

    expect(principal).toBe(edital);
  });
});
