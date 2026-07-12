import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { EscanearAnexoUseCase } from '../../application/use-cases/escanear-anexo.js';
import { AnexoAprovado, AnexoRejeitado } from '../../application/events.js';
import type {
  AnexoEditalRepository,
  AnexoMetadados,
  AnexoScanner,
  EventPublisher,
  ExtratorDeTexto,
  ObjectStorage,
} from '../../application/ports.js';

const EDITAL_ID = EditalId('edital-001');
const NOME_ANEXO = 'edital.pdf';
const SEQUENCIAL_DOCUMENTO = 1;
const STORAGE_KEY = 'editais/edital-001/anexos/edital.pdf';
const noop = new AbortController().signal;

function criarAnexo(
  estado: AnexoMetadados['estadoConfianca'],
  sequencialDocumento = SEQUENCIAL_DOCUMENTO,
): AnexoMetadados {
  return {
    sequencialDocumento,
    nome: NOME_ANEXO,
    storageKey: STORAGE_KEY,
    tamanhoBytes: 1024,
    tipoMime: 'application/pdf',
    tipoDocumentoId: 2,
    tipoDocumentoNome: 'Edital',
    textoKey: '',
    paginas: 0,
    estadoConfianca: estado,
  };
}

function criarRepo(anexos: AnexoMetadados[]): AnexoEditalRepository {
  return {
    listarPorEdital: vi.fn().mockResolvedValue(anexos),
    salvar: vi.fn(),
    atualizarEstado: vi.fn(),
    atualizarTexto: vi.fn(),
  };
}

function criarPublisher(): EventPublisher {
  return { publicar: vi.fn() };
}

function criarObjectStorage(): ObjectStorage {
  return {
    armazenar: vi.fn().mockResolvedValue(`${STORAGE_KEY}.txt`),
    obter: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    deletar: vi.fn(),
  };
}

function criarExtrator(): ExtratorDeTexto {
  return {
    extrair: vi.fn().mockResolvedValue({ texto: 'texto extraído', paginas: 7, temTextoSelecionavel: true }),
  };
}

// AB14 · Teste 1: anexo pendente (não escaneado) — recusado pelo consumer
describe('EscanearAnexoUseCase', () => {
  it('transiciona para limpo e emite AnexoAprovado quando scan limpo', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar({ editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: STORAGE_KEY }, noop);

    expect(repo.atualizarEstado).toHaveBeenCalledWith(EDITAL_ID, SEQUENCIAL_DOCUMENTO, 'limpo', noop);
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
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar({ editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: STORAGE_KEY }, noop);

    expect(repo.atualizarEstado).toHaveBeenCalledWith(EDITAL_ID, SEQUENCIAL_DOCUMENTO, 'rejeitado', noop);
    const publicarCallR = (publisher.publicar as ReturnType<typeof vi.fn>).mock.calls[0] as unknown[];
    const [eventoR] = publicarCallR as [AnexoRejeitado];
    expect(eventoR).toBeInstanceOf(AnexoRejeitado);
  });

  // P-104/AB14 · trust-gating estrito: rejeitado NUNCA é aberto pelo parser (RAD-280)
  it('anexo rejeitado nunca é lido/extraído — o parser não abre bytes reprovados no scan', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('rejeitado') };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar({ editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: STORAGE_KEY }, noop);

    expect(objectStorage.obter).not.toHaveBeenCalled();
    expect(extrator.extrair).not.toHaveBeenCalled();
    expect(repo.atualizarTexto).not.toHaveBeenCalled();
  });

  // P-110/RAD-280: extração só roda DEPOIS do scan aprovar, nunca antes
  it('scan limpo: extrai o texto do binário já aprovado e grava textoKey/paginas antes de promover o estado', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar({ editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: STORAGE_KEY }, noop);

    expect(objectStorage.obter).toHaveBeenCalledWith(STORAGE_KEY, noop);
    expect(extrator.extrair).toHaveBeenCalledWith(expect.any(Uint8Array), 'application/pdf', noop);
    expect(objectStorage.armazenar).toHaveBeenCalledWith(
      `editais/${EDITAL_ID}/anexos/${SEQUENCIAL_DOCUMENTO}.txt`,
      expect.any(Uint8Array),
      { contentType: 'text/plain; charset=utf-8' },
      noop,
    );
    expect(repo.atualizarTexto).toHaveBeenCalledWith(EDITAL_ID, SEQUENCIAL_DOCUMENTO, `${STORAGE_KEY}.txt`, 7, noop);
  });

  // AB14 · Teste 3: falha do scanner — não promove (permanece pendente)
  it('não atualiza estado quando scanner lança erro (isola sem promover)', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = {
      escanear: vi.fn().mockRejectedValue(new Error('scanner timeout')),
    };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await expect(
      uc.executar({ editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: STORAGE_KEY }, noop),
    ).rejects.toThrow('scanner timeout');

    expect(repo.atualizarEstado).not.toHaveBeenCalled();
    expect(publisher.publicar).not.toHaveBeenCalled();
    expect(extrator.extrair).not.toHaveBeenCalled();
  });

  // AB14 · Teste 4: idempotência — já limpo, reprocesso é no-op
  it('é no-op se o anexo já está limpo (idempotente)', async () => {
    const repo = criarRepo([criarAnexo('limpo')]);
    const scanner: AnexoScanner = { escanear: vi.fn() };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar({ editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: STORAGE_KEY }, noop);

    expect(scanner.escanear).not.toHaveBeenCalled();
    expect(repo.atualizarEstado).not.toHaveBeenCalled();
    expect(publisher.publicar).not.toHaveBeenCalled();
    expect(extrator.extrair).not.toHaveBeenCalled();
  });

  // AB14 · Teste 5: transições auditáveis — eventos têm editalId e nome
  it('eventos emitidos carregam editalId e nomeAnexo para auditoria', async () => {
    const repo = criarRepo([criarAnexo('pendente')]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar({ editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: STORAGE_KEY }, noop);

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
      sequencialDocumento: SEQUENCIAL_DOCUMENTO,
      nome: NOME_ANEXO,
      storageKey: DB_STORAGE_KEY,
      tamanhoBytes: 1024,
      tipoMime: 'application/pdf',
      tipoDocumentoId: 2,
      tipoDocumentoNome: 'Edital',
      textoKey: '',
      paginas: 0,
      estadoConfianca: 'pendente',
    };
    const repo = criarRepo([anexoNoBD]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar(
      { editalId: EDITAL_ID, sequencialDocumento: SEQUENCIAL_DOCUMENTO, storageKey: CRAFTED_KEY },
      noop,
    );

    expect(scanner.escanear).toHaveBeenCalledWith(DB_STORAGE_KEY, noop);
    expect(scanner.escanear).not.toHaveBeenCalledWith(CRAFTED_KEY, expect.anything());
    expect(objectStorage.obter).toHaveBeenCalledWith(DB_STORAGE_KEY, noop);
  });

  // RAD-291 · dois anexos com título duplicado (sequencialDocumento distinto):
  // escanear um não deve tocar nem promover o estado do outro.
  it('distingue anexos de título duplicado por sequencialDocumento — não promove o outro', async () => {
    const anexo1 = criarAnexo('pendente', 1);
    const anexo2 = criarAnexo('pendente', 2);
    const repo = criarRepo([anexo1, anexo2]);
    const scanner: AnexoScanner = { escanear: vi.fn().mockResolvedValue('limpo') };
    const publisher = criarPublisher();
    const objectStorage = criarObjectStorage();
    const extrator = criarExtrator();
    const uc = new EscanearAnexoUseCase(scanner, repo, publisher, objectStorage, extrator);

    await uc.executar({ editalId: EDITAL_ID, sequencialDocumento: 1, storageKey: STORAGE_KEY }, noop);

    expect(repo.atualizarEstado).toHaveBeenCalledTimes(1);
    expect(repo.atualizarEstado).toHaveBeenCalledWith(EDITAL_ID, 1, 'limpo', noop);
    expect(repo.atualizarEstado).not.toHaveBeenCalledWith(EDITAL_ID, 2, expect.anything(), expect.anything());
  });
});
