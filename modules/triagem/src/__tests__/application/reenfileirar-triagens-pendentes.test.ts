import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { ReenfileirarTriagensPendentesUseCase } from '../../application/use-cases/reenfileirar-triagens-pendentes.js';
import { Triagem } from '../../domain/triagem.js';
import type { DocumentosEditalGateway, DocumentosRef, EventPublisher, TriagemRepository } from '../../application/ports.js';

const noop = new AbortController().signal;
const EDITAL = EditalId('edital-1');

function pendente(perfilId: string, tenantId = 'tenant-1', clienteFinalId = 'cliente-1') {
  return Triagem.pendente(EDITAL, PerfilId(perfilId), TenantId(tenantId), ClienteFinalId(clienteFinalId));
}

function docsVazios(): DocumentosRef {
  return { editalId: EDITAL, arquivos: [] };
}

function docsDisponiveis(): DocumentosRef {
  return {
    editalId: EDITAL,
    arquivos: [
      {
        nome: 'edital.pdf',
        storageKey: 'sk',
        tipoMime: 'application/pdf',
        sequencialDocumento: 1,
        tipoDocumentoId: 2,
        tipoDocumentoNome: 'Edital',
        textoKey: 'sk.txt',
        paginas: 5,
      },
    ],
  };
}

function deps(opts: { pendentes?: Triagem[]; docs?: DocumentosRef }) {
  const listarProcessandoPorEdital = vi.fn().mockResolvedValue(opts.pendentes ?? []);
  const salvar = vi.fn().mockResolvedValue(undefined);
  const triagens: TriagemRepository = {
    porEditalEPerfil: vi.fn(),
    salvar,
    listarProcessandoPorEdital,
  };
  const obterRefs = vi.fn().mockResolvedValue(opts.docs ?? docsVazios());
  const documentosGateway: DocumentosEditalGateway = { obterRefs };
  const publicar = vi.fn().mockResolvedValue(undefined);
  const eventos: EventPublisher = { publicar };

  const uc = new ReenfileirarTriagensPendentesUseCase(triagens, documentosGateway, eventos);
  return { uc, listarProcessandoPorEdital, salvar, obterRefs, publicar };
}

describe('ReenfileirarTriagensPendentesUseCase (P-110/RAD-281)', () => {
  it('nenhuma triagem processando para o edital → no-op (nem consulta o ACL)', async () => {
    const { uc, obterRefs, publicar } = deps({ pendentes: [] });
    await uc.executar({ editalId: EDITAL, restamAnexosPendentes: false }, noop);
    expect(obterRefs).not.toHaveBeenCalled();
    expect(publicar).not.toHaveBeenCalled();
  });

  it('documento principal disponível → reenfileira triagem.solicitada para CADA triagem processando', async () => {
    const pendentes = [pendente('perfil-1'), pendente('perfil-2', 'tenant-2', 'cliente-2')];
    const { uc, publicar, salvar } = deps({ pendentes, docs: docsDisponiveis() });

    await uc.executar({ editalId: EDITAL, restamAnexosPendentes: false }, noop);

    expect(publicar).toHaveBeenCalledTimes(2);
    expect(publicar.mock.calls.map((c) => c[0].type)).toEqual(['triagem.solicitada', 'triagem.solicitada']);
    expect(publicar.mock.calls[0]![0].payload).toMatchObject({
      tenantId: 'tenant-1', usuarioId: 'cliente-1', editalId: EDITAL, perfilId: PerfilId('perfil-1'), coorteTrial: false,
    });
    expect(publicar.mock.calls[1]![0].payload).toMatchObject({
      tenantId: 'tenant-2', usuarioId: 'cliente-2', editalId: EDITAL, perfilId: PerfilId('perfil-2'), coorteTrial: false,
    });
    expect(salvar).not.toHaveBeenCalled(); // reenfileirar não muda o estado — o worker de triagem que decide
  });

  it('nenhum documento disponível MAS ainda restam anexos pendentes de scan → no-op (aguarda o próximo evento)', async () => {
    const { uc, publicar, salvar } = deps({ pendentes: [pendente('perfil-1')], docs: docsVazios() });

    await uc.executar({ editalId: EDITAL, restamAnexosPendentes: true }, noop);

    expect(publicar).not.toHaveBeenCalled();
    expect(salvar).not.toHaveBeenCalled();
  });

  it('nenhum documento disponível e NENHUM anexo pendente resta → falha terminal (falha_ocr + triagem.falhou)', async () => {
    const pendentes = [pendente('perfil-1'), pendente('perfil-2', 'tenant-2', 'cliente-2')];
    const { uc, publicar, salvar } = deps({ pendentes, docs: docsVazios() });

    await uc.executar({ editalId: EDITAL, restamAnexosPendentes: false }, noop);

    expect(salvar).toHaveBeenCalledTimes(2);
    expect(salvar.mock.calls[0]![0].status).toBe('falha_ocr');
    expect(publicar).toHaveBeenCalledTimes(2);
    expect(publicar.mock.calls[0]![0]).toMatchObject({
      type: 'triagem.falhou',
      payload: { tenantId: 'tenant-1', clienteFinalId: 'cliente-1', editalId: EDITAL, perfilId: PerfilId('perfil-1'), motivo: 'OCR_FALHOU' },
    });
  });
});
