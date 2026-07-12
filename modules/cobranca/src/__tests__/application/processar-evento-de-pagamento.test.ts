import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { ProcessarEventoDePagamentoUseCase } from '../../application/use-cases/processar-evento-de-pagamento.js';
import { Assinatura } from '../../domain/entities/assinatura.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import { CicloDeFaturamento } from '../../domain/value-objects/ciclo-de-faturamento.js';
import { PlanoComercial } from '../../domain/value-objects/plano-comercial.js';
import type { ComandoPagamento } from '../../application/dtos.js';

const SIGNAL = new AbortController().signal;
const TENANT = TenantId('tenant-webhook-1');
const EXT_ID = 'sub_ext_123';

const ciclo = CicloDeFaturamento.criar(new Date('2026-07-01T00:00:00Z'), new Date('2026-08-01T00:00:00Z'));
const plano = PlanoComercial.criar({ codigo: 'starter', cotaTriagensMes: 30, precoCentavos: 9900 });

function assinaturaTrial(): Assinatura {
  return Assinatura.criar({
    tenantId: TENANT,
    estado: 'trial',
    plano,
    cicloVigente: ciclo,
    usoReservado: 0,
    usoConfirmado: 0,
    assinaturaExternaId: EXT_ID,
  });
}

function assinaturaAtiva(): Assinatura {
  return assinaturaTrial().ativar(EXT_ID);
}

function makeDeps(opts?: {
  assinatura?: Assinatura | null;
  primeiraEntrega?: boolean;
  statusExterno?: { statusExterno: string; proximoVencimento: Date | null } | null;
  auditoriaFalha?: boolean;
}) {
  const assinaturas = {
    porTenantId: vi.fn(),
    porAssinaturaExternaId: vi.fn().mockResolvedValue(opts?.assinatura ?? null),
    salvar: vi.fn().mockResolvedValue(undefined),
    reservarCota: vi.fn(),
    liberarReserva: vi.fn(),
    confirmarUso: vi.fn(),
  };
  const webhookEventos = {
    registrarSePrimeiraVez: vi.fn().mockResolvedValue(opts?.primeiraEntrega ?? true),
    desfazerRegistro: vi.fn().mockResolvedValue(undefined),
  };
  const gateway = {
    criarClienteDeCobranca: vi.fn(),
    abrirCheckoutHospedado: vi.fn(),
    consultarAssinatura: vi.fn().mockResolvedValue(
      opts?.statusExterno === undefined ? { statusExterno: 'active', proximoVencimento: null } : opts.statusExterno,
    ),
    cancelarAssinatura: vi.fn(),
  };
  const auditoria = {
    registrar: opts?.auditoriaFalha
      ? vi.fn().mockRejectedValue(new Error('trilha indisponível'))
      : vi.fn().mockResolvedValue(undefined),
  };
  return { assinaturas, webhookEventos, gateway, auditoria };
}

function comandoConfirmado(eventoExternoId = 'evt-1'): ComandoPagamento {
  return { tipo: 'PagamentoConfirmado', eventoExternoId, assinaturaExternaId: EXT_ID };
}

describe('ProcessarEventoDePagamentoUseCase — dedupe (anti-replay)', () => {
  it('replay do mesmo eventId ⇒ no-op: não consulta assinatura nem gateway', async () => {
    const deps = makeDeps({ primeiraEntrega: false });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.assinaturas.porAssinaturaExternaId).not.toHaveBeenCalled();
    expect(deps.gateway.consultarAssinatura).not.toHaveBeenCalled();
    expect(deps.assinaturas.salvar).not.toHaveBeenCalled();
  });
});

describe('ProcessarEventoDePagamentoUseCase — anti-IDOR', () => {
  it('assinaturaExternaId desconhecida ⇒ descarta e audita, nunca cria assinatura', async () => {
    const deps = makeDeps({ assinatura: null });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.assinaturas.salvar).not.toHaveBeenCalled();
    expect(deps.gateway.consultarAssinatura).not.toHaveBeenCalled();
    expect(deps.auditoria.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: null, decisao: 'DESCARTADO_ASSINATURA_EXTERNA_DESCONHECIDA' }),
      SIGNAL,
    );
  });
});

describe('ProcessarEventoDePagamentoUseCase — confirmação outbound (P-107 (5))', () => {
  it('PagamentoConfirmado sem confirmação do gateway ⇒ NÃO ativa', async () => {
    const deps = makeDeps({ assinatura: assinaturaTrial(), statusExterno: null });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.gateway.consultarAssinatura).toHaveBeenCalledExactlyOnceWith(EXT_ID, SIGNAL);
    expect(deps.assinaturas.salvar).not.toHaveBeenCalled();
    expect(deps.auditoria.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ decisao: 'NAO_ATIVADO_CONFIRMACAO_OUTBOUND_FALHOU' }),
      SIGNAL,
    );
  });

  it('PagamentoConfirmado com status externo não-confirmado (ex.: pending) ⇒ NÃO ativa', async () => {
    const deps = makeDeps({
      assinatura: assinaturaTrial(),
      statusExterno: { statusExterno: 'pending', proximoVencimento: null },
    });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.assinaturas.salvar).not.toHaveBeenCalled();
  });

  it('PagamentoConfirmado com confirmação do gateway ⇒ ativa e persiste', async () => {
    const deps = makeDeps({ assinatura: assinaturaTrial() });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.assinaturas.salvar).toHaveBeenCalledOnce();
    const [salva] = deps.assinaturas.salvar.mock.calls[0]!;
    expect(salva.estado).toBe('ativa');
    expect(deps.auditoria.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: TENANT, decisao: 'ATIVADA' }),
      SIGNAL,
    );
  });
});

describe('ProcessarEventoDePagamentoUseCase — demais transições', () => {
  it('PagamentoFalhou marca inadimplente sem chamar o gateway', async () => {
    const deps = makeDeps({ assinatura: assinaturaAtiva() });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar({ tipo: 'PagamentoFalhou', eventoExternoId: 'evt-2', assinaturaExternaId: EXT_ID }, SIGNAL);

    expect(deps.gateway.consultarAssinatura).not.toHaveBeenCalled();
    expect(deps.assinaturas.salvar).toHaveBeenCalledOnce();
    const [salva] = deps.assinaturas.salvar.mock.calls[0]!;
    expect(salva.estado).toBe('inadimplente');
  });

  it('AssinaturaCancelada cancela sem chamar o gateway', async () => {
    const deps = makeDeps({ assinatura: assinaturaAtiva() });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar({ tipo: 'AssinaturaCancelada', eventoExternoId: 'evt-3', assinaturaExternaId: EXT_ID }, SIGNAL);

    const [salva] = deps.assinaturas.salvar.mock.calls[0]!;
    expect(salva.estado).toBe('cancelada');
  });

  it('transição inválida (ex.: cancelar já cancelada) vira no-op auditado, não lança', async () => {
    const jaCancelada = assinaturaAtiva().cancelar();
    const deps = makeDeps({ assinatura: jaCancelada });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await expect(
      uc.executar({ tipo: 'AssinaturaCancelada', eventoExternoId: 'evt-4', assinaturaExternaId: EXT_ID }, SIGNAL),
    ).resolves.toBeUndefined();

    expect(deps.assinaturas.salvar).not.toHaveBeenCalled();
    expect(deps.auditoria.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ decisao: 'IGNORADO_TRANSICAO_INVALIDA' }),
      SIGNAL,
    );
  });
});

describe('ProcessarEventoDePagamentoUseCase — renovação de ciclo (RAD-277)', () => {
  it('PagamentoConfirmado para assinatura já ativa ⇒ renova o ciclo (rollover), não re-ativa', async () => {
    const proximoVencimento = new Date('2026-09-01T00:00:00Z');
    const deps = makeDeps({
      assinatura: assinaturaAtiva(),
      statusExterno: { statusExterno: 'active', proximoVencimento },
    });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.assinaturas.salvar).toHaveBeenCalledOnce();
    const [salva] = deps.assinaturas.salvar.mock.calls[0]!;
    expect(salva.estado).toBe('ativa');
    expect(salva.cicloVigente.inicio).toEqual(ciclo.fim); // contíguo ao ciclo anterior
    expect(salva.cicloVigente.fim).toEqual(proximoVencimento);
    expect(deps.auditoria.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ tenantId: TENANT, decisao: 'CICLO_RENOVADO' }),
      SIGNAL,
    );
  });

  it('cota esgotada no ciclo N → invoice.paid do ciclo N+1 ⇒ contadores zerados (nova solicitação passaria)', async () => {
    const esgotada = Assinatura.criar({
      tenantId: TENANT,
      estado: 'ativa',
      plano,
      cicloVigente: ciclo,
      usoReservado: 30,
      usoConfirmado: 30,
      assinaturaExternaId: EXT_ID,
    });
    const deps = makeDeps({
      assinatura: esgotada,
      statusExterno: { statusExterno: 'active', proximoVencimento: new Date('2026-09-01T00:00:00Z') },
    });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    const [salva] = deps.assinaturas.salvar.mock.calls[0]!;
    expect(salva.usoReservado).toBe(0);
    expect(salva.usoConfirmado).toBe(0);
  });

  it('renovação sem proximoVencimento confirmado pelo gateway ⇒ NÃO renova, audita e não lança', async () => {
    const deps = makeDeps({
      assinatura: assinaturaAtiva(),
      statusExterno: { statusExterno: 'active', proximoVencimento: null },
    });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await expect(uc.executar(comandoConfirmado(), SIGNAL)).resolves.toBeUndefined();

    expect(deps.assinaturas.salvar).not.toHaveBeenCalled();
    expect(deps.auditoria.registrar).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ decisao: 'IGNORADO_RENOVACAO_SEM_PROXIMO_VENCIMENTO' }),
      SIGNAL,
    );
  });

  it('idempotência: reentrega do mesmo eventoExternoId depois do rollover é no-op (não zera duas vezes)', async () => {
    const deps = makeDeps({
      assinatura: assinaturaAtiva(),
      primeiraEntrega: false,
      statusExterno: { statusExterno: 'active', proximoVencimento: new Date('2026-09-01T00:00:00Z') },
    });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado('evt-replay'), SIGNAL);

    expect(deps.gateway.consultarAssinatura).not.toHaveBeenCalled();
    expect(deps.assinaturas.salvar).not.toHaveBeenCalled();
  });
});

describe('ProcessarEventoDePagamentoUseCase — auditoria fail-closed', () => {
  it('falha ao gravar auditoria vira AuditoriaIndisponivelError', async () => {
    const deps = makeDeps({ assinatura: null, auditoriaFalha: true });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await expect(uc.executar(comandoConfirmado(), SIGNAL)).rejects.toThrow(AuditoriaIndisponivelError);
  });
});

describe('ProcessarEventoDePagamentoUseCase — compensação do dedupe em falha (resistente a replay de verdade)', () => {
  it('auditoria falha DEPOIS de ativar e persistir ⇒ desfaz o claim do dedupe (permite reentrega reprocessar)', async () => {
    const deps = makeDeps({ assinatura: assinaturaTrial(), auditoriaFalha: true });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await expect(uc.executar(comandoConfirmado('evt-rollback'), SIGNAL)).rejects.toThrow(AuditoriaIndisponivelError);

    // a mutação foi persistida (não há transação cross-repositório neste caso),
    // mas o claim de dedupe É desfeito — sem isso a reentrega do Asaas (at-least-once)
    // cairia como replay para sempre e a falta de auditoria nunca se resolveria.
    expect(deps.assinaturas.salvar).toHaveBeenCalledOnce();
    expect(deps.webhookEventos.desfazerRegistro).toHaveBeenCalledExactlyOnceWith('asaas', 'evt-rollback', SIGNAL);
  });

  it('descarte por assinatura desconhecida com auditoria indisponível ⇒ também desfaz o claim', async () => {
    const deps = makeDeps({ assinatura: null, auditoriaFalha: true });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await expect(uc.executar(comandoConfirmado('evt-rollback-2'), SIGNAL)).rejects.toThrow(AuditoriaIndisponivelError);

    expect(deps.webhookEventos.desfazerRegistro).toHaveBeenCalledExactlyOnceWith('asaas', 'evt-rollback-2', SIGNAL);
  });

  it('sucesso (auditoria grava) ⇒ NUNCA desfaz o claim do dedupe', async () => {
    const deps = makeDeps({ assinatura: assinaturaTrial() });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.webhookEventos.desfazerRegistro).not.toHaveBeenCalled();
  });

  it('replay (dedupe já visto) ⇒ nunca chama desfazerRegistro (não há claim desta chamada para desfazer)', async () => {
    const deps = makeDeps({ primeiraEntrega: false });
    const uc = new ProcessarEventoDePagamentoUseCase(deps.assinaturas, deps.webhookEventos, deps.gateway, deps.auditoria);

    await uc.executar(comandoConfirmado(), SIGNAL);

    expect(deps.webhookEventos.desfazerRegistro).not.toHaveBeenCalled();
  });
});
