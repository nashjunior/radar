import { Before, Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import { TenantId } from '@radar/kernel';
import {
  Assinatura,
  AssinaturaInativaError,
  AssinaturaNaoEncontradaError,
  CicloDeFaturamento,
  CotaExcedidaError,
  LiberarReservaUseCase,
  PlanoComercial,
  ReservarCotaUseCase,
} from '@radar/cobranca';
import { PostgresAssinaturaRepository } from '@radar/cobranca/infra';
import { getFixture } from '../support/hooks.js';

const SIGNAL = new AbortController().signal;
const CICLO = CicloDeFaturamento.criar(new Date('2026-01-01'), new Date('2026-02-01'));
const CLOCK = { agora: () => new Date() };

interface CobrancaCtx {
  erroCatch: unknown;
  reservaConcedida: boolean | null;
  resultadosConcorrencia: Array<'concedida' | 'negada' | 'erro-inesperado'>;
}

const ctx: CobrancaCtx = {
  erroCatch: null,
  reservaConcedida: null,
  resultadosConcorrencia: [],
};

Before(function () {
  ctx.erroCatch = null;
  ctx.reservaConcedida = null;
  ctx.resultadosConcorrencia = [];
});

function repo(): PostgresAssinaturaRepository {
  return new PostgresAssinaturaRepository(getFixture().db);
}

// ---------------------------------------------------------------------------
// Given
// ---------------------------------------------------------------------------

Given('um repositório de assinaturas no PostgreSQL', function () {});

Given(
  'uma assinatura ativa do tenant {string} com cota {int} e uso reservado {int}',
  async function (tenantIdRaw: string, cota: number, usoReservado: number) {
    const tenantId = TenantId(tenantIdRaw);
    const plano = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: cota, precoCentavos: 12900 });
    const assinatura = Assinatura.criar({
      tenantId,
      estado: 'ativa',
      plano,
      cicloVigente: CICLO,
      usoReservado,
      usoConfirmado: 0,
      assinaturaExternaId: 'ext-bdd',
    });
    await repo().salvar(assinatura, SIGNAL);
  },
);

Given(
  'uma assinatura suspensa do tenant {string} com cota {int} e uso reservado {int}',
  async function (tenantIdRaw: string, cota: number, usoReservado: number) {
    const tenantId = TenantId(tenantIdRaw);
    const plano = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: cota, precoCentavos: 12900 });
    const suspensa = Assinatura.iniciarTrial(tenantId, plano, CICLO)
      .ativar('ext-bdd')
      .marcarInadimplente()
      .suspender();
    const assinatura = Assinatura.criar({ ...suspensa, usoReservado });
    await repo().salvar(assinatura, SIGNAL);
  },
);

// RAD-277: trial vencido (cicloVigente.fim no passado) — o gate do PRÓPRIO
// Postgres (`periodo_fim > now()`) precisa barrar, não só a leitura de apoio.
Given(
  'uma assinatura em trial vencido do tenant {string} com cota {int} e uso reservado {int}',
  async function (tenantIdRaw: string, cota: number, usoReservado: number) {
    const tenantId = TenantId(tenantIdRaw);
    const plano = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: cota, precoCentavos: 12900 });
    const cicloVencido = CicloDeFaturamento.criar(new Date('2020-01-01'), new Date('2020-01-15'));
    const trial = Assinatura.iniciarTrial(tenantId, plano, cicloVencido);
    const assinatura = Assinatura.criar({ ...trial, usoReservado });
    await repo().salvar(assinatura, SIGNAL);
  },
);

// ---------------------------------------------------------------------------
// When
// ---------------------------------------------------------------------------

When('o sistema reserva a cota do tenant {string}', async function (tenantIdRaw: string) {
  const uc = new ReservarCotaUseCase(repo(), CLOCK);
  await uc.executar({ tenantId: TenantId(tenantIdRaw) }, SIGNAL);
  ctx.reservaConcedida = true;
});

When('o sistema tenta reservar a cota do tenant {string}', async function (tenantIdRaw: string) {
  const uc = new ReservarCotaUseCase(repo(), CLOCK);
  try {
    await uc.executar({ tenantId: TenantId(tenantIdRaw) }, SIGNAL);
    ctx.reservaConcedida = true;
  } catch (erro) {
    ctx.erroCatch = erro;
  }
});

When('o sistema libera a reserva do tenant {string}', async function (tenantIdRaw: string) {
  const uc = new LiberarReservaUseCase(repo());
  await uc.executar({ tenantId: TenantId(tenantIdRaw) }, SIGNAL);
});

// `confirmarUso` é chamado direto no repositório (não via `ConfirmarUsoUseCase`,
// que também grava `RegistroDeUso`/publica evento) — o que este cenário prova é o
// contrato do adapter com o gate (RAD-275), não a orquestração de RAD-247.
When('o sistema confirma o uso do tenant {string}', async function (tenantIdRaw: string) {
  await repo().confirmarUso(TenantId(tenantIdRaw), SIGNAL);
});

When(
  '{int} requisições paralelas tentam reservar a cota do tenant {string}',
  async function (quantidade: number, tenantIdRaw: string) {
    const tenantId = TenantId(tenantIdRaw);
    // Uma única PostgresAssinaturaRepository por requisição, todas sobre o MESMO
    // pool de conexões real (getFixture().db) — a atomicidade vem do UPDATE no
    // Postgres, não de qualquer coordenação em JS (prova a garantia real, P-107 (3)).
    ctx.resultadosConcorrencia = await Promise.all(
      Array.from({ length: quantidade }, () => {
        const uc = new ReservarCotaUseCase(repo(), CLOCK);
        return uc.executar({ tenantId }, SIGNAL).then(
          (): 'concedida' => 'concedida',
          (erro: unknown): 'negada' | 'erro-inesperado' =>
            erro instanceof CotaExcedidaError ? 'negada' : 'erro-inesperado',
        );
      }),
    );
  },
);

// ---------------------------------------------------------------------------
// Then
// ---------------------------------------------------------------------------

Then('a reserva deve ser concedida', function () {
  assert.equal(ctx.reservaConcedida, true, 'Esperava reserva concedida (sem erro lançado)');
});

Then('o uso reservado do tenant {string} deve ser {int}', async function (tenantIdRaw: string, esperado: number) {
  const assinatura = await repo().porTenantId(TenantId(tenantIdRaw), SIGNAL);
  assert.ok(assinatura, `Assinatura do tenant '${tenantIdRaw}' não encontrada`);
  assert.equal(assinatura.usoReservado, esperado);
});

Then('a operação deve lançar CotaExcedidaError com cota {int} e usado {int}', function (cota: number, usado: number) {
  assert.ok(ctx.erroCatch instanceof CotaExcedidaError, `Esperava CotaExcedidaError, recebeu ${String(ctx.erroCatch)}`);
  const erro = ctx.erroCatch as CotaExcedidaError;
  assert.equal(erro.cota, cota);
  assert.equal(erro.usoReservado, usado);
});

Then('a operação deve lançar AssinaturaInativaError', function () {
  assert.ok(
    ctx.erroCatch instanceof AssinaturaInativaError,
    `Esperava AssinaturaInativaError, recebeu ${String(ctx.erroCatch)}`,
  );
});

Then('a operação deve lançar AssinaturaNaoEncontradaError', function () {
  assert.ok(
    ctx.erroCatch instanceof AssinaturaNaoEncontradaError,
    `Esperava AssinaturaNaoEncontradaError, recebeu ${String(ctx.erroCatch)}`,
  );
});

Then('exatamente {int} requisição deve ter sido concedida', function (quantidade: number) {
  const concedidas = ctx.resultadosConcorrencia.filter((r) => r === 'concedida');
  assert.equal(concedidas.length, quantidade);
});

Then('exatamente {int} requisições devem ter recebido CotaExcedidaError', function (quantidade: number) {
  const negadas = ctx.resultadosConcorrencia.filter((r) => r === 'negada');
  const inesperadas = ctx.resultadosConcorrencia.filter((r) => r === 'erro-inesperado');
  assert.equal(inesperadas.length, 0, 'Não esperava nenhum erro fora de CotaExcedidaError');
  assert.equal(negadas.length, quantidade);
});
