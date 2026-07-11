/**
 * Testes unitários: DocumentosEditalAclAdapter
 *
 * ACL adapter entre Ingestão (DocumentosDoEditalPort → AnexosDTO) e
 * Triagem (DocumentosEditalGateway → DocumentosRef).
 *
 * Cobre: mapeamento de campos, isolamento de bounded-context (tamanhoBytes não vaza),
 * preservação de editalId, propagação de AbortSignal.
 */
import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import type { DocumentosDoEditalPort, AnexosDTO } from '@radar/ingestao';
import { DocumentosEditalAclAdapter } from '../../infra/documentos-edital-acl-adapter.js';

const EDITAL_ID = EditalId('edital-001');

function makePort(dto: AnexosDTO): DocumentosDoEditalPort {
  return { obterDocumentos: vi.fn().mockResolvedValue(dto) };
}

const DTO_BASE: AnexosDTO = {
  editalId: EDITAL_ID,
  arquivos: [
    { nome: 'edital.pdf', storageKey: 'editais/001/edital.pdf', tipoMime: 'application/pdf', tamanhoBytes: 102400 },
    { nome: 'anexo-i.docx', storageKey: 'editais/001/anexo-i.docx', tipoMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', tamanhoBytes: 20480 },
  ],
};

describe('DocumentosEditalAclAdapter', () => {
  it('retorna DocumentosRef com editalId preservado', async () => {
    const port = makePort(DTO_BASE);
    const adapter = new DocumentosEditalAclAdapter(port);
    const noop = new AbortController().signal;

    const result = await adapter.obterRefs(EDITAL_ID, noop);

    expect(result.editalId).toBe(EDITAL_ID);
  });

  it('mapeia todos os arquivos (nome, storageKey, tipoMime)', async () => {
    const port = makePort(DTO_BASE);
    const adapter = new DocumentosEditalAclAdapter(port);
    const noop = new AbortController().signal;

    const result = await adapter.obterRefs(EDITAL_ID, noop);

    expect(result.arquivos).toHaveLength(2);
    expect(result.arquivos[0]).toEqual({
      nome: 'edital.pdf',
      storageKey: 'editais/001/edital.pdf',
      tipoMime: 'application/pdf',
    });
  });

  it('não vaza tamanhoBytes — isolamento de bounded-context', async () => {
    const port = makePort(DTO_BASE);
    const adapter = new DocumentosEditalAclAdapter(port);
    const noop = new AbortController().signal;

    const result = await adapter.obterRefs(EDITAL_ID, noop);

    for (const a of result.arquivos) {
      expect(a).not.toHaveProperty('tamanhoBytes');
    }
  });

  it('retorna lista vazia quando não há arquivos', async () => {
    const dto: AnexosDTO = { editalId: EDITAL_ID, arquivos: [] };
    const port = makePort(dto);
    const adapter = new DocumentosEditalAclAdapter(port);
    const noop = new AbortController().signal;

    const result = await adapter.obterRefs(EDITAL_ID, noop);

    expect(result.arquivos).toHaveLength(0);
  });

  it('propaga AbortSignal ao port (P-78)', async () => {
    const obterDocumentos = vi.fn().mockResolvedValue(DTO_BASE);
    const port: DocumentosDoEditalPort = { obterDocumentos };
    const adapter = new DocumentosEditalAclAdapter(port);
    const ac = new AbortController();

    await adapter.obterRefs(EDITAL_ID, ac.signal);

    expect(obterDocumentos).toHaveBeenCalledWith(EDITAL_ID, ac.signal);
  });
});
