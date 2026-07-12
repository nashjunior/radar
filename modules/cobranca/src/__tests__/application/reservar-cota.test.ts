import { describe, expect, it } from 'vitest';
import { TenantId } from '@radar/kernel';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import {
  AssinaturaInativaError,
  AssinaturaNaoEncontradaError,
  CotaExcedidaError,
} from '../../domain/errors/index.js';
import { ReservarCotaUseCase } from '../../application/use-cases/reservar-cota.js';
import type { AssinaturaRepository } from '../../application/ports.js';

const SIGNAL = new AbortController().signal;
const CICLO = CicloDeFaturamento.criar(new Date('2026-01-01'), new Date('2026-02-01'));
const AGORA = new Date('2026-01-15');
const CLOCK = { agora: () => AGORA };
/** Espelha `Assinatura.MULTIPLICADOR_TETO_CARENCIA` (RAD-290) — mesmo placeholder [A VALIDAR]. */
const MULTIPLICADOR_TETO_CARENCIA = 2;

function planoCom(cota: number, codigo = 'starter'): PlanoComercial {
  return PlanoComercial.criar({ codigo, cotaTriagensMes: cota, precoCentavos: 12900 });
}

/**
 * Fake em memória que respeita o MESMO contrato de atomicidade do UPDATE real:
 * `reservarCota` faz o check-and-increment num único trecho SÍNCRONO (sem
 * `await` entre a leitura e a escrita). Como Node é single-threaded, chamadas
 * concorrentes via `Promise.all` nunca intercalam dentro desse trecho — a mesma
 * garantia que o Postgres dá com um único `UPDATE ... RETURNING` (provada contra
 * banco real em tests/bdd/features/cobranca). Isso torna o fake apto a testar o
 * CONTRATO de concorrência do use case sem subir um Postgres neste pacote.
 */
class FakeAssinaturaRepository implements AssinaturaRepository {
  private readonly porTenant = new Map<string, Assinatura>();

  definir(tenantId: TenantId, assinatura: Assinatura): void {
    this.porTenant.set(tenantId, assinatura);
  }

  async porTenantId(tenantId: TenantId, _signal: AbortSignal): Promise<Assinatura | null> {
    return this.porTenant.get(tenantId) ?? null;
  }

  /** Fora do escopo de RAD-246 (é RAD-250) — presente só para satisfazer a interface. */
  async porAssinaturaExternaId(assinaturaExternaId: string, _signal: AbortSignal): Promise<Assinatura | null> {
    for (const assinatura of this.porTenant.values()) {
      if (assinatura.assinaturaExternaId === assinaturaExternaId) return assinatura;
    }
    return null;
  }

  async salvar(assinatura: Assinatura, _signal: AbortSignal): Promise<void> {
    this.porTenant.set(assinatura.tenantId, assinatura);
  }

  async reservarCota(tenantId: TenantId, _signal: AbortSignal): Promise<boolean> {
    const atual = this.porTenant.get(tenantId);
    if (!atual) return false;
    if (atual.estado !== 'ativa' && atual.estado !== 'trial') return false;
    if (atual.trialVencido(AGORA)) return false; // RAD-277 — mesmo gate do adapter Postgres

    // RAD-290 (corrige RAD-287) — ciclo `ativa` vencido entra em CARÊNCIA por
    // tempo, nunca renova aqui: espelha o WHERE do UPDATE atômico real
    // (PostgresAssinaturaRepository), NUNCA a escrita de `periodo_*`/`uso_confirmado`
    // — isso é só `renovarCiclo` via `invoice.paid`. Reaproveita `Assinatura.emCarencia`
    // (mesmo padrão de `trialVencido` acima) em vez de reimplementar a aritmética da janela.
    const cota = atual.plano.cota.valor;
    const teto = atual.emCarencia(AGORA) ? cota * MULTIPLICADOR_TETO_CARENCIA : cota;
    if (atual.usoReservado >= teto) return false;

    // Mutação síncrona, sem await antes daqui — replica a semântica do UPDATE atômico.
    // NUNCA toca cicloVigente/usoConfirmado — só invoice.paid (renovarCiclo) muda o relógio do ciclo.
    this.porTenant.set(
      tenantId,
      Assinatura.criar({
        tenantId: atual.tenantId,
        estado: atual.estado,
        plano: atual.plano,
        cicloVigente: atual.cicloVigente,
        usoReservado: atual.usoReservado + 1,
        usoConfirmado: atual.usoConfirmado,
        assinaturaExternaId: atual.assinaturaExternaId,
      }),
    );
    return true;
  }

  async liberarReserva(tenantId: TenantId, _signal: AbortSignal): Promise<void> {
    const atual = this.porTenant.get(tenantId);
    if (!atual) return;
    this.porTenant.set(
      tenantId,
      Assinatura.criar({
        tenantId: atual.tenantId,
        estado: atual.estado,
        plano: atual.plano,
        cicloVigente: atual.cicloVigente,
        usoReservado: Math.max(atual.usoReservado - 1, 0),
        usoConfirmado: atual.usoConfirmado,
        assinaturaExternaId: atual.assinaturaExternaId,
      }),
    );
  }

  /** Fora do escopo de RAD-246 (é RAD-247) — presente só para satisfazer a interface. */
  async confirmarUso(tenantId: TenantId, _signal: AbortSignal): Promise<void> {
    const atual = this.porTenant.get(tenantId);
    if (!atual) return;
    this.porTenant.set(
      tenantId,
      Assinatura.criar({
        tenantId: atual.tenantId,
        estado: atual.estado,
        plano: atual.plano,
        cicloVigente: atual.cicloVigente,
        usoReservado: Math.max(atual.usoReservado - 1, 0),
        usoConfirmado: atual.usoConfirmado + 1,
        assinaturaExternaId: atual.assinaturaExternaId,
      }),
    );
  }
}

describe('ReservarCotaUseCase — gate de entitlement (P-107 (3))', () => {
  it('concede a reserva quando a cota comporta', async () => {
    const tenantId = TenantId('tenant-ok');
    const repo = new FakeAssinaturaRepository();
    repo.definir(tenantId, Assinatura.iniciarTrial(tenantId, planoCom(5), CICLO));

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).resolves.toBeUndefined();

    const assinatura = await repo.porTenantId(tenantId, SIGNAL);
    expect(assinatura?.usoReservado).toBe(1);
  });

  it('lança CotaExcedidaError com cota/usado/upgradeDisponivel quando a cota já está esgotada', async () => {
    const tenantId = TenantId('tenant-cota-cheia');
    const repo = new FakeAssinaturaRepository();
    const assinatura = Assinatura.iniciarTrial(tenantId, planoCom(1, 'starter'), CICLO).ativar('ext-1');
    repo.definir(tenantId, Assinatura.criar({ ...assinatura, usoReservado: 1 }));

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    const erro = await uc.executar({ tenantId }, SIGNAL).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(CotaExcedidaError);
    const cotaErro = erro as CotaExcedidaError;
    expect(cotaErro.cota).toBe(1);
    expect(cotaErro.usoReservado).toBe(1);
    expect(cotaErro.upgradeDisponivel).toBe(true); // starter não é o topo do MVP (pro)
  });

  it('não oferece upgrade quando o plano já é o topo do MVP (pro)', async () => {
    const tenantId = TenantId('tenant-pro-cheio');
    const repo = new FakeAssinaturaRepository();
    const assinatura = Assinatura.iniciarTrial(tenantId, planoCom(1, 'pro'), CICLO).ativar('ext-2');
    repo.definir(tenantId, Assinatura.criar({ ...assinatura, usoReservado: 1 }));

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    const erro = await uc.executar({ tenantId }, SIGNAL).catch((e: unknown) => e);

    expect(erro).toBeInstanceOf(CotaExcedidaError);
    expect((erro as CotaExcedidaError).upgradeDisponivel).toBe(false);
  });

  it('lança AssinaturaInativaError quando a assinatura está suspensa', async () => {
    const tenantId = TenantId('tenant-suspenso');
    const repo = new FakeAssinaturaRepository();
    const suspensa = Assinatura.iniciarTrial(tenantId, planoCom(5), CICLO).ativar('ext-3').marcarInadimplente().suspender();
    repo.definir(tenantId, suspensa);

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).rejects.toBeInstanceOf(AssinaturaInativaError);
  });

  it('lança AssinaturaNaoEncontradaError quando não há assinatura para o tenant', async () => {
    const tenantId = TenantId('tenant-inexistente');
    const repo = new FakeAssinaturaRepository();

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).rejects.toBeInstanceOf(AssinaturaNaoEncontradaError);
  });

  it('lança AssinaturaInativaError (não CotaExcedidaError) quando o trial venceu, mesmo com cota sobrando (RAD-277)', async () => {
    const tenantId = TenantId('tenant-trial-vencido');
    const repo = new FakeAssinaturaRepository();
    const cicloVencido = CicloDeFaturamento.criar(new Date('2025-12-01'), new Date('2025-12-15')); // fim antes de AGORA
    repo.definir(tenantId, Assinatura.iniciarTrial(tenantId, planoCom(5), cicloVencido));

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).rejects.toBeInstanceOf(AssinaturaInativaError);

    const assinatura = await repo.porTenantId(tenantId, SIGNAL);
    expect(assinatura?.usoReservado).toBe(0); // nada foi reservado
  });

  it('concorrência: N requisições paralelas com cota=1 ⇒ exatamente 1 concedida, N-1 recebem CotaExcedidaError', async () => {
    const tenantId = TenantId('tenant-concorrente');
    const repo = new FakeAssinaturaRepository();
    repo.definir(tenantId, Assinatura.iniciarTrial(tenantId, planoCom(1), CICLO).ativar('ext-4'));

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    const N = 20;
    const resultados = await Promise.all(
      Array.from({ length: N }, () =>
        uc.executar({ tenantId }, SIGNAL).then(
          () => 'concedida' as const,
          (erro: unknown) => (erro instanceof CotaExcedidaError ? 'negada' as const : 'erro-inesperado' as const),
        ),
      ),
    );

    expect(resultados.filter((r) => r === 'concedida')).toHaveLength(1);
    expect(resultados.filter((r) => r === 'negada')).toHaveLength(N - 1);
    expect(resultados.filter((r) => r === 'erro-inesperado')).toHaveLength(0);

    const assinaturaFinal = await repo.porTenantId(tenantId, SIGNAL);
    expect(assinaturaFinal?.usoReservado).toBe(1); // nunca ultrapassa a cota, mesmo sob concorrência
  });
});

describe('ReservarCotaUseCase — carência por tempo do ciclo `ativa` vencido (RAD-290, corrige RAD-287)', () => {
  it('dentro da carência, com a cota do ciclo vencido esgotada, ainda concede — dívida acima da cota, SEM renovar/resetar', async () => {
    const tenantId = TenantId('tenant-ciclo-vencido-carencia');
    const repo = new FakeAssinaturaRepository();
    // fim 2 dias antes de AGORA (2026-01-15) — dentro da carência de 3 dias
    const cicloVencido = CicloDeFaturamento.criar(new Date('2025-12-14'), new Date('2026-01-13'));
    const ativaEsgotada = Assinatura.criar({
      tenantId,
      estado: 'ativa',
      plano: planoCom(5),
      cicloVigente: cicloVencido,
      usoReservado: 5, // == cota — antes do RAD-290 isso bloqueava até o próximo invoice.paid
      usoConfirmado: 5,
      assinaturaExternaId: 'ext-vencido',
    });
    repo.definir(tenantId, ativaEsgotada);

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).resolves.toBeUndefined();

    const depois = await repo.porTenantId(tenantId, SIGNAL);
    expect(depois?.usoReservado).toBe(6); // dívida acima da cota — nunca reseta
    expect(depois?.usoConfirmado).toBe(5); // fatura do ciclo anterior sobrevive — só invoice.paid zera
    expect(depois?.cicloVigente.inicio).toEqual(cicloVencido.inicio); // relógio do ciclo intocado
    expect(depois?.cicloVigente.fim).toEqual(cicloVencido.fim);
  });

  it('nega quando o teto de carência (2x a cota) já foi atingido, mesmo dentro da janela', async () => {
    const tenantId = TenantId('tenant-teto-carencia');
    const repo = new FakeAssinaturaRepository();
    const cicloVencido = CicloDeFaturamento.criar(new Date('2025-12-14'), new Date('2026-01-13')); // dentro da carência
    const noTeto = Assinatura.criar({
      tenantId,
      estado: 'ativa',
      plano: planoCom(5),
      cicloVigente: cicloVencido,
      usoReservado: 10, // == 2x cota — teto duro
      usoConfirmado: 5,
      assinaturaExternaId: 'ext-teto',
    });
    repo.definir(tenantId, noTeto);

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).rejects.toBeInstanceOf(CotaExcedidaError);

    const depois = await repo.porTenantId(tenantId, SIGNAL);
    expect(depois?.usoReservado).toBe(10); // nada foi reservado
  });

  it('nega quando a carência expirou (fora da janela), mesmo achando que ainda tem cota', async () => {
    const tenantId = TenantId('tenant-carencia-expirada');
    const repo = new FakeAssinaturaRepository();
    // fim 14 dias antes de AGORA — muito além da carência de 3 dias
    const cicloVencido = CicloDeFaturamento.criar(new Date('2025-12-01'), new Date('2026-01-01'));
    const semRenovacao = Assinatura.criar({
      tenantId,
      estado: 'ativa',
      plano: planoCom(5),
      cicloVigente: cicloVencido,
      usoReservado: 5, // == cota, e a carência já não cobre mais
      usoConfirmado: 5,
      assinaturaExternaId: 'ext-expirado',
    });
    repo.definir(tenantId, semRenovacao);

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).rejects.toBeInstanceOf(CotaExcedidaError);
  });

  it('ciclo ainda vigente com cota esgotada continua negando (carência não é bypass geral)', async () => {
    const tenantId = TenantId('tenant-cota-cheia-vigente');
    const repo = new FakeAssinaturaRepository();
    const ativaEsgotada = Assinatura.criar({
      tenantId,
      estado: 'ativa',
      plano: planoCom(5),
      cicloVigente: CICLO, // vigente: 2026-01-01 a 2026-02-01, AGORA = 2026-01-15
      usoReservado: 5,
      usoConfirmado: 5,
      assinaturaExternaId: 'ext-vigente',
    });
    repo.definir(tenantId, ativaEsgotada);

    const uc = new ReservarCotaUseCase(repo, CLOCK);
    await expect(uc.executar({ tenantId }, SIGNAL)).rejects.toBeInstanceOf(CotaExcedidaError);
  });
});

describe('LiberarReservaUseCase — compensação da reserva (P-107 (c))', () => {
  it('decrementa usoReservado', async () => {
    const tenantId = TenantId('tenant-liberar');
    const repo = new FakeAssinaturaRepository();
    const ativa = Assinatura.iniciarTrial(tenantId, planoCom(5), CICLO).ativar('ext-5');
    repo.definir(tenantId, Assinatura.criar({ ...ativa, usoReservado: 1 }));

    const { LiberarReservaUseCase } = await import('../../application/use-cases/liberar-reserva.js');
    const uc = new LiberarReservaUseCase(repo);
    await uc.executar({ tenantId }, SIGNAL);

    const assinatura = await repo.porTenantId(tenantId, SIGNAL);
    expect(assinatura?.usoReservado).toBe(0);
  });

  it('nunca deixa usoReservado negativo', async () => {
    const tenantId = TenantId('tenant-liberar-zero');
    const repo = new FakeAssinaturaRepository();
    repo.definir(tenantId, Assinatura.iniciarTrial(tenantId, planoCom(5), CICLO));

    const { LiberarReservaUseCase } = await import('../../application/use-cases/liberar-reserva.js');
    const uc = new LiberarReservaUseCase(repo);
    await uc.executar({ tenantId }, SIGNAL);

    const assinatura = await repo.porTenantId(tenantId, SIGNAL);
    expect(assinatura?.usoReservado).toBe(0);
  });
});
