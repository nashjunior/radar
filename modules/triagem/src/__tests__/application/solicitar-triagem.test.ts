import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { SolicitarTriagemUseCase } from '../../application/use-cases/solicitar-triagem.js';
import type { SolicitarTriagemInput } from '../../application/use-cases/solicitar-triagem.js';
import type { EventPublisher, PerfilGateway, TriagemRepository } from '../../application/ports.js';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';

const noop = new AbortController().signal;

const EDITAL = EditalId('edital-1');
const PERFIL = PerfilId('perfil-1');
const CLIENTE = ClienteFinalId('cliente-1');
const TENANT = TenantId('global');

const INPUT: SolicitarTriagemInput = {
  editalId: EDITAL,
  perfilId: PERFIL,
  clienteFinalId: CLIENTE,
  tenantId: TENANT,
  coorteTrial: false,
};

const PERFIL_HAB = PerfilHabilitacao.de({
  id: PERFIL,
  clienteFinalId: CLIENTE,
  habJuridica: [],
  habFiscal: [],
  habTecnica: [],
  habEconomica: [],
});

function deps(perfil: PerfilHabilitacao | null) {
  const porId = vi.fn().mockResolvedValue(perfil);
  const publicar = vi.fn().mockResolvedValue(undefined);
  const perfis: PerfilGateway = { porId };
  const eventos: EventPublisher = { publicar };
  const triagens: TriagemRepository = {
    porEditalEPerfil: vi.fn().mockResolvedValue(null),
    salvar: vi.fn().mockResolvedValue(undefined),
    listarProcessandoPorEdital: vi.fn().mockResolvedValue([]),
  };
  return { perfis, triagens, eventos, porId, publicar };
}

describe('SolicitarTriagemUseCase', () => {
  it('publica triagem.solicitada com o payload do comando e propaga o signal (P-78)', async () => {
    const { perfis, triagens, eventos, porId, publicar } = deps(PERFIL_HAB);
    await new SolicitarTriagemUseCase(perfis, triagens, eventos).executar(INPUT, noop);

    expect(porId).toHaveBeenCalledWith(PERFIL, noop);
    expect(publicar).toHaveBeenCalledTimes(1);
    const [evento, signal] = publicar.mock.calls[0]!;
    expect(evento.type).toBe('triagem.solicitada');
    expect(evento.payload).toMatchObject({
      editalId: EDITAL,
      perfilId: PERFIL,
      usuarioId: CLIENTE,
      tenantId: 'global', // MVP single-tenant (P-25)
      coorteTrial: false,
    });
    expect(signal).toBe(noop);
  });

  it('repassa coorteTrial: true (RAD-271) — o BFF já resolveu a assinatura no gate de cota', async () => {
    const { perfis, triagens, eventos, publicar } = deps(PERFIL_HAB);
    await new SolicitarTriagemUseCase(perfis, triagens, eventos).executar(
      { ...INPUT, coorteTrial: true },
      noop,
    );

    const [evento] = publicar.mock.calls[0]!;
    expect(evento.payload).toMatchObject({ coorteTrial: true });
  });

  it('nega e NÃO enfileira quando o perfil não existe (não vaza existência — A17 §5.3)', async () => {
    const { perfis, triagens, eventos, publicar } = deps(null);
    await expect(
      new SolicitarTriagemUseCase(perfis, triagens, eventos).executar(INPUT, noop),
    ).rejects.toThrow(AcessoNegadoError);
    expect(publicar).not.toHaveBeenCalled();
  });

  it('nega e NÃO enfileira pedido de perfil de OUTRO cliente (IDOR/BOLA — P-51)', async () => {
    const { perfis, triagens, eventos, publicar } = deps(
      PerfilHabilitacao.de({
        id: PERFIL,
        clienteFinalId: ClienteFinalId('cliente-999'),
        habJuridica: [],
        habFiscal: [],
        habTecnica: [],
        habEconomica: [],
      }),
    );
    await expect(
      new SolicitarTriagemUseCase(perfis, triagens, eventos).executar(INPUT, noop),
    ).rejects.toThrow(AcessoNegadoError);
    expect(publicar).not.toHaveBeenCalled();
  });
});
