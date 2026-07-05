import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { SolicitarTriagemUseCase } from '../../application/use-cases/solicitar-triagem.js';
import type { SolicitarTriagemInput } from '../../application/use-cases/solicitar-triagem.js';
import type { EventPublisher, PerfilGateway } from '../../application/ports.js';
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
  return { perfis, eventos, porId, publicar };
}

describe('SolicitarTriagemUseCase', () => {
  it('publica triagem.solicitada com o payload do comando e propaga o signal (P-78)', async () => {
    const { perfis, eventos, porId, publicar } = deps(PERFIL_HAB);
    await new SolicitarTriagemUseCase(perfis, eventos).executar(INPUT, noop);

    expect(porId).toHaveBeenCalledWith(PERFIL, noop);
    expect(publicar).toHaveBeenCalledTimes(1);
    const [evento, signal] = publicar.mock.calls[0]!;
    expect(evento.type).toBe('triagem.solicitada');
    expect(evento.payload).toMatchObject({
      editalId: EDITAL,
      perfilId: PERFIL,
      usuarioId: CLIENTE,
      tenantId: 'global', // MVP single-tenant (P-25)
    });
    expect(signal).toBe(noop);
  });

  it('nega e NÃO enfileira quando o perfil não existe (não vaza existência — A17 §5.3)', async () => {
    const { perfis, eventos, publicar } = deps(null);
    await expect(
      new SolicitarTriagemUseCase(perfis, eventos).executar(INPUT, noop),
    ).rejects.toThrow(AcessoNegadoError);
    expect(publicar).not.toHaveBeenCalled();
  });

  it('nega e NÃO enfileira pedido de perfil de OUTRO cliente (IDOR/BOLA — P-51)', async () => {
    const { perfis, eventos, publicar } = deps(
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
      new SolicitarTriagemUseCase(perfis, eventos).executar(INPUT, noop),
    ).rejects.toThrow(AcessoNegadoError);
    expect(publicar).not.toHaveBeenCalled();
  });
});
