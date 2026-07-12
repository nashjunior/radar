import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { LiberarReservaUseCase } from '../../application/use-cases/liberar-reserva.js';

const TENANT = TenantId('tenant-001');
const noop = new AbortController().signal;

function makeAssinaturas() {
  return {
    porTenantId: vi.fn(),
    porAssinaturaExternaId: vi.fn(),
    salvar: vi.fn(),
    reservarCota: vi.fn(),
    confirmarUso: vi.fn(),
    liberarReserva: vi.fn().mockResolvedValue(undefined),
  };
}

// Consumidor de triagem.falhou/DLQ (RAD-247, RAD-248) — reusa o mesmo use case do
// gate síncrono (RAD-246): "libera 1 unidade de uso_reservado" é a mesma operação
// de domínio nos dois caminhos.
describe('LiberarReservaUseCase — caminho triagem.falhou/DLQ (P-107 (c))', () => {
  it('libera a reserva do tenant e não grava RegistroDeUso (não existe repositório de RegistroDeUso no construtor)', async () => {
    const assinaturas = makeAssinaturas();
    const uc = new LiberarReservaUseCase(assinaturas);

    await uc.executar({ tenantId: TENANT }, noop);

    expect(assinaturas.liberarReserva).toHaveBeenCalledExactlyOnceWith(TENANT, noop);
  });

  it('reprocessar a mesma falha (at-least-once) libera de novo — idempotência é do piso em zero no adapter, não deste use case', async () => {
    const assinaturas = makeAssinaturas();
    const uc = new LiberarReservaUseCase(assinaturas);

    await uc.executar({ tenantId: TENANT }, noop);
    await uc.executar({ tenantId: TENANT }, noop);
    await uc.executar({ tenantId: TENANT }, noop);

    expect(assinaturas.liberarReserva).toHaveBeenCalledTimes(3);
  });
});
