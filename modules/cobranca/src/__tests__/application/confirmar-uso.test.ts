import { describe, expect, it, vi } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, RegistroDeUsoId, TenantId } from '@radar/kernel';
import { ConfirmarUsoUseCase } from '../../application/use-cases/confirmar-uso.js';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { AssinaturaNaoEncontradaError } from '../../domain/errors/index.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';

const TENANT = TenantId('tenant-001');
const INPUT = {
  tenantId: TENANT,
  clienteFinalId: ClienteFinalId('cliente-001'),
  editalId: EditalId('edital-001'),
  perfilId: PerfilId('perfil-001'),
  confirmadoEm: new Date('2026-07-11T12:00:00Z'),
};
const noop = new AbortController().signal;

function planoComCota(cota: number) {
  return PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: cota, precoCentavos: 9900 });
}

const ciclo = CicloDeFaturamento.criar(new Date('2026-07-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));

function assinaturaCom(usoReservado: number, usoConfirmado: number, cota = 10) {
  return Assinatura.criar({
    tenantId: TENANT,
    estado: 'ativa',
    plano: planoComCota(cota),
    cicloVigente: ciclo,
    usoReservado,
    usoConfirmado,
    assinaturaExternaId: 'ext-1',
  });
}

function makeAssinaturas(assinatura: Assinatura | null) {
  return {
    porTenantId: vi.fn().mockResolvedValue(assinatura),
    porAssinaturaExternaId: vi.fn(),
    salvar: vi.fn(),
    reservarCota: vi.fn(),
    liberarReserva: vi.fn(),
    confirmarUso: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRegistros(inserirRetorna: boolean[]) {
  const registrar = vi.fn();
  inserirRetorna.forEach(v => registrar.mockResolvedValueOnce(v));
  return { registrar };
}

function makeIds() {
  let n = 0;
  return { gerar: vi.fn(() => RegistroDeUsoId(`registro-${++n}`)) };
}

function makeEventos() {
  return { publicar: vi.fn().mockResolvedValue(undefined) };
}

describe('ConfirmarUsoUseCase', () => {
  it('lança AssinaturaNaoEncontradaError quando não há assinatura para o tenant', async () => {
    const uc = new ConfirmarUsoUseCase(makeAssinaturas(null), makeRegistros([true]), makeIds(), makeEventos());
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(AssinaturaNaoEncontradaError);
  });

  it('primeira entrega: grava RegistroDeUso e confirma uso', async () => {
    const assinaturas = makeAssinaturas(assinaturaCom(1, 0));
    const registros = makeRegistros([true]);
    const uc = new ConfirmarUsoUseCase(assinaturas, registros, makeIds(), makeEventos());

    await uc.executar(INPUT, noop);

    expect(registros.registrar).toHaveBeenCalledOnce();
    expect(assinaturas.confirmarUso).toHaveBeenCalledExactlyOnceWith(TENANT, noop);
  });

  it('mesmo triagem.concluida entregue 3x ⇒ 1 RegistroDeUso, confirmarUso chamado 1x (idempotência P-107 (4))', async () => {
    const assinaturas = makeAssinaturas(assinaturaCom(1, 0));
    const registros = makeRegistros([true, false, false]); // 1ª insere, 2ª/3ª são duplo-clique/replay
    const uc = new ConfirmarUsoUseCase(assinaturas, registros, makeIds(), makeEventos());

    await uc.executar(INPUT, noop);
    await uc.executar(INPUT, noop);
    await uc.executar(INPUT, noop);

    expect(registros.registrar).toHaveBeenCalledTimes(3);
    expect(assinaturas.confirmarUso).toHaveBeenCalledOnce();
  });

  it('replay (registrar retorna false) não mexe no agregado', async () => {
    const assinaturas = makeAssinaturas(assinaturaCom(1, 0));
    const registros = makeRegistros([false]);
    const uc = new ConfirmarUsoUseCase(assinaturas, registros, makeIds(), makeEventos());

    await uc.executar(INPUT, noop);

    expect(assinaturas.confirmarUso).not.toHaveBeenCalled();
  });

  it('não dispara alerta de cota abaixo de 80%', async () => {
    const assinaturas = makeAssinaturas(assinaturaCom(1, 0, 10)); // 10%
    const eventos = makeEventos();
    const uc = new ConfirmarUsoUseCase(assinaturas, makeRegistros([true]), makeIds(), eventos);

    await uc.executar(INPUT, noop);

    expect(eventos.publicar).not.toHaveBeenCalled();
  });

  it('dispara alerta de 80% ao cruzar o limiar', async () => {
    const assinaturas = makeAssinaturas(assinaturaCom(8, 0, 10)); // 80%
    const eventos = makeEventos();
    const uc = new ConfirmarUsoUseCase(assinaturas, makeRegistros([true]), makeIds(), eventos);

    await uc.executar(INPUT, noop);

    expect(eventos.publicar).toHaveBeenCalledOnce();
    const [evento] = eventos.publicar.mock.calls[0]!;
    expect(evento.type).toBe('assinatura.cota_alerta');
    expect(evento.payload.percentual).toBe(80);
  });

  it('dispara só o alerta de 100% (não os dois) quando a cota já está esgotada', async () => {
    const assinaturas = makeAssinaturas(assinaturaCom(10, 0, 10)); // 100%
    const eventos = makeEventos();
    const uc = new ConfirmarUsoUseCase(assinaturas, makeRegistros([true]), makeIds(), eventos);

    await uc.executar(INPUT, noop);

    expect(eventos.publicar).toHaveBeenCalledOnce();
    const [evento] = eventos.publicar.mock.calls[0]!;
    expect(evento.payload.percentual).toBe(100);
  });
});
