import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { DocumentosDoEditalAdapter } from '../../infra/adapters/documentos-do-edital-adapter.js';
import type { AnexoEditalRepository, AnexoMetadados } from '../../application/ports.js';
import type { BaixarAnexosEditalUseCase } from '../../application/use-cases/baixar-anexos-edital.js';

const EDITAL_ID = EditalId('edital-001');
const noop = new AbortController().signal;

function makeAnexo(
  nome: string,
  estado: AnexoMetadados['estadoConfianca'],
): AnexoMetadados {
  return { nome, storageKey: `editais/001/${nome}`, tamanhoBytes: 1024, tipoMime: 'application/pdf', estadoConfianca: estado };
}

function makeRepo(anexos: AnexoMetadados[]): AnexoEditalRepository {
  return { listarPorEdital: vi.fn().mockResolvedValue(anexos), salvar: vi.fn(), atualizarEstado: vi.fn() };
}

function makeBaixar(): BaixarAnexosEditalUseCase {
  return { executar: vi.fn().mockResolvedValue(undefined) } as unknown as BaixarAnexosEditalUseCase;
}

// AB14 · Trust-gating: DocumentosDoEditalAdapter (P-104, fail-closed)
describe('DocumentosDoEditalAdapter', () => {
  // 1. Happy path: retorna somente limpos
  it('retorna arquivos limpos sem expor estadoConfianca', async () => {
    const repo = makeRepo([makeAnexo('edital.pdf', 'limpo')]);
    const adapter = new DocumentosDoEditalAdapter(makeBaixar(), repo);

    const dto = await adapter.obterDocumentos(EDITAL_ID, noop);

    expect(dto.arquivos).toHaveLength(1);
    expect(dto.arquivos[0]!.nome).toBe('edital.pdf');
    expect('estadoConfianca' in dto.arquivos[0]!).toBe(false);
  });

  // 2. Fail-closed: pendente não vaza
  it('retorna lista vazia quando todos os anexos estão pendentes (quarentena)', async () => {
    const repo = makeRepo([makeAnexo('edital.pdf', 'pendente')]);
    const baixar = makeBaixar();
    const adapter = new DocumentosDoEditalAdapter(baixar, repo);

    const dto = await adapter.obterDocumentos(EDITAL_ID, noop);

    expect(dto.arquivos).toHaveLength(0);
    expect(baixar.executar).not.toHaveBeenCalled();
  });

  // 3. Fail-closed: rejeitado não vaza
  it('retorna lista vazia quando todos os anexos foram rejeitados (ameaça AV)', async () => {
    const repo = makeRepo([makeAnexo('edital.pdf', 'rejeitado')]);
    const baixar = makeBaixar();
    const adapter = new DocumentosDoEditalAdapter(baixar, repo);

    const dto = await adapter.obterDocumentos(EDITAL_ID, noop);

    expect(dto.arquivos).toHaveLength(0);
    expect(baixar.executar).not.toHaveBeenCalled();
  });

  // 4. Mix: só limpos retornados, pendentes/rejeitados filtrados
  it('retorna apenas limpos quando há mix de estados', async () => {
    const repo = makeRepo([
      makeAnexo('clean.pdf', 'limpo'),
      makeAnexo('quarantined.pdf', 'pendente'),
      makeAnexo('threat.pdf', 'rejeitado'),
    ]);
    const adapter = new DocumentosDoEditalAdapter(makeBaixar(), repo);

    const dto = await adapter.obterDocumentos(EDITAL_ID, noop);

    expect(dto.arquivos).toHaveLength(1);
    expect(dto.arquivos[0]!.nome).toBe('clean.pdf');
  });

  // 5. Nenhum anexo ainda: dispara download e retorna vazio
  it('dispara BaixarAnexosEditalUseCase quando ainda não há nenhum anexo', async () => {
    const repo = makeRepo([]);
    const baixar = makeBaixar();
    const adapter = new DocumentosDoEditalAdapter(baixar, repo);

    const dto = await adapter.obterDocumentos(EDITAL_ID, noop);

    expect(baixar.executar).toHaveBeenCalledWith({ editalId: EDITAL_ID }, noop);
    expect(dto.arquivos).toHaveLength(0);
  });

  // 6. Tem pendentes mas não tem limpos: NÃO re-dispara download
  it('não re-dispara download quando há pendentes mas zero limpos', async () => {
    const repo = makeRepo([makeAnexo('quarantined.pdf', 'pendente')]);
    const baixar = makeBaixar();
    const adapter = new DocumentosDoEditalAdapter(baixar, repo);

    await adapter.obterDocumentos(EDITAL_ID, noop);

    expect(baixar.executar).not.toHaveBeenCalled();
  });

  // 7. AbortSignal propagado ao repositório
  it('propaga AbortSignal ao repositório', async () => {
    const repo = makeRepo([]);
    const ac = new AbortController();
    const adapter = new DocumentosDoEditalAdapter(makeBaixar(), repo);

    await adapter.obterDocumentos(EDITAL_ID, ac.signal);

    expect(repo.listarPorEdital).toHaveBeenCalledWith(EDITAL_ID, ac.signal);
  });
});
