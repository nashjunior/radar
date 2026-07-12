import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { IniciarTrialUseCase } from '../../application/use-cases/iniciar-trial.js';
import type { AssinaturaRepository, ClockProvider } from '../../application/ports.js';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';

const noop = new AbortController().signal;
const TENANT = TenantId('tenant-1');
const AGORA = new Date('2026-07-12T00:00:00.000Z');

function deps() {
  const assinaturas: AssinaturaRepository = {
    porTenantId: vi.fn().mockResolvedValue(null),
    porAssinaturaExternaId: vi.fn(),
    salvar: vi.fn().mockResolvedValue(undefined),
    reservarCota: vi.fn(),
    liberarReserva: vi.fn(),
    confirmarUso: vi.fn(),
  };
  const clock: ClockProvider = { agora: () => AGORA };
  return { assinaturas, clock };
}

describe('IniciarTrialUseCase', () => {
  it('cria uma Assinatura trial com cota de 5 triagens em 14 dias, sem cartão', async () => {
    const { assinaturas, clock } = deps();
    const uc = new IniciarTrialUseCase(assinaturas, clock);

    await uc.executar({ tenantId: TENANT }, noop);

    expect(assinaturas.salvar).toHaveBeenCalledOnce();
    const assinaturaSalva = (assinaturas.salvar as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Assinatura;
    expect(assinaturaSalva.tenantId).toBe(TENANT);
    expect(assinaturaSalva.estado).toBe('trial');
    expect(assinaturaSalva.plano.codigo).toBe('trial');
    expect(assinaturaSalva.plano.cota.valor).toBe(5);
    expect(assinaturaSalva.plano.precoCentavos).toBe(0);
    expect(assinaturaSalva.assinaturaExternaId).toBeNull();
    expect(assinaturaSalva.cicloVigente.inicio).toEqual(AGORA);
    expect(assinaturaSalva.cicloVigente.fim).toEqual(new Date('2026-07-26T00:00:00.000Z'));
  });

  it('idempotente: já existir Assinatura para o tenant é no-op (não sobrescreve)', async () => {
    const { assinaturas, clock } = deps();
    const existente = Assinatura.iniciarTrial(
      TENANT,
      PlanoComercial.criar({ codigo: 'trial', cotaTriagensMes: 5, precoCentavos: 0 }),
      CicloDeFaturamento.criar(AGORA, new Date('2026-07-26T00:00:00.000Z')),
    );
    (assinaturas.porTenantId as ReturnType<typeof vi.fn>).mockResolvedValue(existente);

    const uc = new IniciarTrialUseCase(assinaturas, clock);
    await uc.executar({ tenantId: TENANT }, noop);

    expect(assinaturas.salvar).not.toHaveBeenCalled();
  });
});
