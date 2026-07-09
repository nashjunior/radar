import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { EscanearAnexoUseCase } from '../../application/use-cases/escanear-anexo.js';
import { AnexoAprovado, AnexoRejeitado } from '../../application/events.js';
import type {
  AnexoEditalRepository,
  AnexoMetadados,
  AnexoScanner,
  EventPublisher,
} from '../../application/ports.js';

const EDITAL_ID = EditalId('edital-001');
const NOME_ANEXO = 'edital.pdf';
const STORAGE_KEY = 'editais/edital-001/anexos/edital.pdf';
const noop = new AbortController().signal;

function criarAnexo(estado: AnexoMetadados['estadoConfianca']): AnexoMetadados {
  return {
    nome: NOME_ANEXO,
    storageKey: STORAGE_KEY,
    tamanhoBytes: 1024,
    tipoMime: 'application/pdf',
    estadoConfianca: estado,
  };
}

function criarRepo(anexos: AnexoMetadados[]): AnexoEditalRepository {
  return {
    listarPorEdital: vi.fn().mockResolvedValue(anexos),
    salvar: vi.fn(),
    atualizarEstado: vi.fn(),
  };
}

function criarPublisher(): EventPublisher {
  return { publicar: vi.fn() };
}

// AB14 · Teste 1: anexo pendente (não escaneado) — recusado pelo consumer
describe('EscanearAnexoUseCase', () => {
  it('transiciona para limpo e emite AnexoAprovado quando scan limpo', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher);

    await uc.executar({ editalId: EDITAL_ID, nomeAnexo: NOME_ANEXO, storageKey: STORAGE_KEY }, noop);

    expect(repo.atualizarEstado).toHaveBeenCalledWith(EDITAL_ID, NOME_ANEXO, 'limpo', noop);
    const publicarCall0 = (publisher.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const [evento] = publicarCall0 as [AnexoAprovado];
    expect(evento).toBeInstanceOf(AnexoAprovado);
    expect(evento.payload.nomeAnexo).toBe(NOME_ANEXO);
  });

  // AB14 · Teste 2: anexo com ameaça detectada — rejeitado e isolado
  it('transiciona para rejeitado e emite AnexoRejeitado quando scanner detecta ameaça', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('rejeitado') };
    const publisher = criarPublisher();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher);

    await uc.executar({ editalId: EDITAL_ID, nomeAnexo: NOME_ANEXO, storageKey: STORAGE_KEY }, noop);

    expect(repo.atualizarEstado).toHaveBeenCalledWith(EDITAL_ID, NOME_ANEXO, 'rejeitado', noop);
    const publicarCallR = (publisher.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const [eventoR] = publicarCallR as [AnexoRejeitado];
    expect(eventoR).toBeInstanceOf(AnexoRejeitado);
  });

  // AB14 · Teste 3: falha do scanner — não promove (permanece pendente)
  it('não atualiza estado quando scanner lança erro (isola sem promover)', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = {
      escanear: vi.fn().mockRejectedValue(new Error('scanner timeout')),
    };
    const publisher = criarPublisher();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher);

    await expect(
      uc.executar({ editalId: EDITAL_ID, nomeAnexo: NOME_ANEXO, storageKey: STORAGE_KEY }, noop),
    ).rejects.toThrow('scanner timeout');

    expect(repo.atualizarEstado).not.toHaveBeenCalled();
    expect(publisher.publicar).not.toHaveBeenCalled();
  });

  // AB14 · Teste 4: idempotência — já limpo, reprocesso é no-op
  it('é no-op se o anexo já está limpo (idempotente)', async () => {
    const repo = criarRepo([criarAnexo('limpo')]);
    const scanner: AnexoScanner = { escanear: vi.fn() };
    const publisher = criarPublisher();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher);

    await uc.executar({ editalId: EDITAL_ID, nomeAnexo: NOME_ANEXO, storageKey: STORAGE_KEY }, noop);

    expect(scanner.escanear).not.toHaveBeenCalled();
    expect(repo.atualizarEstado).not.toHaveBeenCalled();
    expect(publisher.publicar).not.toHaveBeenCalled();
  });

  // AB14 · Teste 5: transições auditáveis — eventos têm editalId e nome
  it('eventos emitidos carregam editalId e nomeAnexo para auditoria', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher);

    await uc.executar({ editalId: EDITAL_ID, nomeAnexo: NOME_ANEXO, storageKey: STORAGE_KEY }, noop);

    const publicarCallA = (publisher.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const [eventoA] = publicarCallA as [AnexoAprovado];
    expect(eventoA.payload.editalId).toBe(EDITAL_ID);
    expect(eventoA.payload.nomeAnexo).toBe(NOME_ANEXO);
    expect(eventoA.occurredAt).toBeInstanceOf(Date);
  });

  // RAD-126 · Adversarial: evento com storageKey adulterado — deve usar chave do BD
  // Previne IDOR onde atacante forja evento para escanear objeto arbitrário no storage.
  it('usa storageKey do BD, não do evento, mesmo que o evento traga chave adulterada', async () => {
    const DB_STORAGE_KEY = 'editais/edital-001/anexos/edital.pdf';
    const CRAFTED_KEY = 'editais/outro-tenant/segredo.pdf';

    const anexoNoBD: AnexoMetadados = {
      nome: NOME_ANEXO,
      storageKey: DB_STORAGE_KEY,
      tamanhoBytes: 1024,
      tipoMime: 'application/pdf',
      estadoConfianca: 'pendente',
    };
    const repo = criarRepo([anexoNoBD]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher);

    await uc.executar(
      { editalId: EDITAL_ID, nomeAnexo: NOME_ANEXO, storageKey: CRAFTED_KEY },
      noop,
    );

    expect(scanner.escanear).toHaveBeenCalledWith(DB_STORAGE_KEY, noop);
    expect(scanner.escanear).not.toHaveBeenCalledWith(CRAFTED_KEY, expect.anything());
  });
});
