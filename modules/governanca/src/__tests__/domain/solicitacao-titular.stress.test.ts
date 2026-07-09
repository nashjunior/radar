/**
 * Testes de domínio — SolicitacaoTitular (AB10/P-57/RAD-98/docs/14 §5).
 *
 * Foco: máquina de estados, invariante de identidade (AB10), imutabilidade,
 * motivos de recusa, `atenderParcialmente` (não coberto no nível de use case).
 *
 * Estes testes exercem o AGREGADO diretamente, independente do use case,
 * para garantir que as guardiões de segurança funcionam em isolamento.
 */
import { describe, expect, it } from 'vitest';
import { ClienteFinalId, TenantId } from '@radar/kernel';
import {
  SolicitacaoTitular,
  SolicitacaoId,
  IdentidadeNaoVerificadaError,
} from '../../domain/entities/solicitacao-titular.js';
import type { MotivoRecusa, TipoSolicitacao } from '../../domain/entities/solicitacao-titular.js';

const TENANT = TenantId('tenant-stress');
const CLIENTE = ClienteFinalId('cliente-stress');
const T0 = new Date('2026-07-08T10:00:00Z');
const T1 = new Date('2026-07-08T10:01:00Z');
const T2 = new Date('2026-07-08T10:02:00Z');
const T3 = new Date('2026-07-08T10:03:00Z');
const T4 = new Date('2026-07-08T10:04:00Z');
const T5 = new Date('2026-07-08T10:05:00Z');

function novaRecebida(tipo: TipoSolicitacao = 'acesso', id = 'sol-001'): SolicitacaoTitular {
  return SolicitacaoTitular.criar({
    id: SolicitacaoId(id),
    tipo,
    tenantId: TENANT,
    clienteFinalId: CLIENTE,
    titularRef: 'titular-hash-xyz',
    criadaEm: T0,
  });
}

describe('SolicitacaoTitular — criação', () => {
  it('estado inicial é recebida', () => {
    expect(novaRecebida().estado).toBe('recebida');
  });

  it('criação sem clienteFinalId — campo é undefined', () => {
    const s = SolicitacaoTitular.criar({
      id: SolicitacaoId('sol-x'),
      tipo: 'acesso',
      tenantId: TENANT,
      titularRef: 'hash',
      criadaEm: T0,
    });
    expect(s.clienteFinalId).toBeUndefined();
    expect(s.estado).toBe('recebida');
  });

  it.each(['acesso', 'correcao', 'eliminacao'] as TipoSolicitacao[])('aceita tipo %s', (tipo) => {
    expect(() => novaRecebida(tipo)).not.toThrow();
    expect(novaRecebida(tipo).tipo).toBe(tipo);
  });

  it('criadaEm e atualizadaEm são iguais na criação', () => {
    const s = novaRecebida();
    expect(s.criadaEm).toBe(T0);
    expect(s.atualizadaEm).toBe(T0);
  });

  it('motivoRecusa é undefined na criação', () => {
    expect(novaRecebida().motivoRecusa).toBeUndefined();
  });
});

describe('SolicitacaoTitular — caminho feliz (recebida → encerrada)', () => {
  function chainFeliz(tipo: TipoSolicitacao = 'acesso') {
    return novaRecebida(tipo)
      .iniciarVerificacao(T1)
      .confirmarIdentidade(T2)
      .iniciarAnalise(T3)
      .atender(T4)
      .encerrar(T5);
  }

  it('estado final é encerrada (acesso)', () => {
    expect(chainFeliz('acesso').estado).toBe('encerrada');
  });

  it.each(['acesso', 'correcao', 'eliminacao'] as TipoSolicitacao[])(
    'tipo %s chega a encerrada pelo caminho feliz',
    (tipo) => {
      expect(chainFeliz(tipo).estado).toBe('encerrada');
    },
  );

  it('atualizadaEm avança a cada transição', () => {
    const s = novaRecebida().iniciarVerificacao(T1);
    expect(s.atualizadaEm).toBe(T1);
    const s2 = s.confirmarIdentidade(T2);
    expect(s2.atualizadaEm).toBe(T2);
  });

  it('motivoRecusa permanece undefined no caminho feliz', () => {
    expect(chainFeliz().motivoRecusa).toBeUndefined();
  });
});

describe('SolicitacaoTitular — atenderParcialmente', () => {
  it('estado parcialmente_atendida → encerrada', () => {
    const s = novaRecebida()
      .iniciarVerificacao(T1)
      .confirmarIdentidade(T2)
      .iniciarAnalise(T3)
      .atenderParcialmente(T4)
      .encerrar(T5);
    expect(s.estado).toBe('encerrada');
  });

  it('atenderParcialmente preserva tipo original', () => {
    const s = novaRecebida('eliminacao')
      .iniciarVerificacao(T1)
      .confirmarIdentidade(T2)
      .iniciarAnalise(T3)
      .atenderParcialmente(T4);
    expect(s.tipo).toBe('eliminacao');
    expect(s.estado).toBe('parcialmente_atendida');
  });
});

describe('SolicitacaoTitular — recusa e encerramento', () => {
  it.each([
    'IDENTIDADE_NAO_VERIFICADA',
    'SEM_DADOS_NO_ESCOPO',
    'OBRIGACAO_LEGAL',
  ] as MotivoRecusa[])('recusar preserva motivo %s', (motivo) => {
    const s = novaRecebida().iniciarVerificacao(T1).recusar(motivo, T2);
    expect(s.estado).toBe('recusada');
    expect(s.motivoRecusa).toBe(motivo);
  });

  it('encerrar após recusa preserva motivoRecusa', () => {
    const s = novaRecebida()
      .iniciarVerificacao(T1)
      .recusar('IDENTIDADE_NAO_VERIFICADA', T2)
      .encerrar(T3);
    expect(s.estado).toBe('encerrada');
    expect(s.motivoRecusa).toBe('IDENTIDADE_NAO_VERIFICADA');
  });
});

describe('SolicitacaoTitular — AB10/P-57: guardiões de identidade', () => {
  it('confirmarIdentidade() de recebida → IdentidadeNaoVerificadaError (precisa de pendente_verificacao)', () => {
    expect(() => novaRecebida().confirmarIdentidade(T1)).toThrow(IdentidadeNaoVerificadaError);
  });

  it('confirmarIdentidade() de identidade_verificada → IdentidadeNaoVerificadaError', () => {
    const s = novaRecebida().iniciarVerificacao(T1).confirmarIdentidade(T2);
    expect(s.estado).toBe('identidade_verificada');
    expect(() => s.confirmarIdentidade(T3)).toThrow(IdentidadeNaoVerificadaError);
  });

  it('confirmarIdentidade() de em_analise → IdentidadeNaoVerificadaError', () => {
    const s = novaRecebida().iniciarVerificacao(T1).confirmarIdentidade(T2).iniciarAnalise(T3);
    expect(() => s.confirmarIdentidade(T4)).toThrow(IdentidadeNaoVerificadaError);
  });

  it('iniciarAnalise() de recebida → IdentidadeNaoVerificadaError', () => {
    expect(() => novaRecebida().iniciarAnalise(T1)).toThrow(IdentidadeNaoVerificadaError);
  });

  it('iniciarAnalise() de pendente_verificacao → IdentidadeNaoVerificadaError', () => {
    const s = novaRecebida().iniciarVerificacao(T1);
    expect(s.estado).toBe('pendente_verificacao');
    expect(() => s.iniciarAnalise(T2)).toThrow(IdentidadeNaoVerificadaError);
  });

  it('iniciarAnalise() de recusada → IdentidadeNaoVerificadaError', () => {
    const s = novaRecebida().iniciarVerificacao(T1).recusar('IDENTIDADE_NAO_VERIFICADA', T2);
    expect(() => s.iniciarAnalise(T3)).toThrow(IdentidadeNaoVerificadaError);
  });

  it('IdentidadeNaoVerificadaError.code = IDENTIDADE_NAO_VERIFICADA', () => {
    try {
      novaRecebida().confirmarIdentidade(T1);
    } catch (e) {
      expect((e as IdentidadeNaoVerificadaError).code).toBe('IDENTIDADE_NAO_VERIFICADA');
    }
  });
});

describe('SolicitacaoTitular — imutabilidade (cada transição retorna nova instância)', () => {
  it('iniciarVerificacao retorna nova instância, original permanece recebida', () => {
    const original = novaRecebida();
    const nova = original.iniciarVerificacao(T1);
    expect(original.estado).toBe('recebida');
    expect(nova.estado).toBe('pendente_verificacao');
    expect(nova).not.toBe(original);
  });

  it('confirmarIdentidade retorna nova instância', () => {
    const s = novaRecebida().iniciarVerificacao(T1);
    const nova = s.confirmarIdentidade(T2);
    expect(s.estado).toBe('pendente_verificacao');
    expect(nova.estado).toBe('identidade_verificada');
  });

  it('id e tenantId são preservados ao longo de todas as transições', () => {
    const final = novaRecebida('eliminacao', 'sol-invariante')
      .iniciarVerificacao(T1)
      .confirmarIdentidade(T2)
      .iniciarAnalise(T3)
      .atender(T4)
      .encerrar(T5);
    expect(final.id).toBe('sol-invariante');
    expect(final.tenantId).toBe(TENANT);
    expect(final.tipo).toBe('eliminacao');
  });
});

describe('SolicitacaoTitular — isolamento de tenant (P-51)', () => {
  it('dois pedidos com tenants distintos não compartilham estado', () => {
    const t1 = TenantId('t-A');
    const t2 = TenantId('t-B');

    const s1 = SolicitacaoTitular.criar({
      id: SolicitacaoId('s1'),
      tipo: 'acesso',
      tenantId: t1,
      titularRef: 'hash-1',
      criadaEm: T0,
    });
    const s2 = SolicitacaoTitular.criar({
      id: SolicitacaoId('s2'),
      tipo: 'eliminacao',
      tenantId: t2,
      titularRef: 'hash-2',
      criadaEm: T0,
    });

    expect(s1.tenantId).toBe(t1);
    expect(s2.tenantId).toBe(t2);
    expect(s1.tenantId).not.toBe(s2.tenantId);
  });
});

describe('SolicitacaoTitular — estabilidade sob carga', () => {
  it('cria 100 solicitações e percorre o caminho feliz sem erro', () => {
    for (let i = 0; i < 100; i++) {
      const final = SolicitacaoTitular.criar({
        id: SolicitacaoId(`sol-${i}`),
        tipo: i % 3 === 0 ? 'acesso' : i % 3 === 1 ? 'correcao' : 'eliminacao',
        tenantId: TenantId(`t-${i % 5}`),
        clienteFinalId: ClienteFinalId(`c-${i}`),
        titularRef: `hash-${i}`,
        criadaEm: T0,
      })
        .iniciarVerificacao(T1)
        .confirmarIdentidade(T2)
        .iniciarAnalise(T3)
        .atender(T4)
        .encerrar(T5);

      expect(final.estado).toBe('encerrada');
      expect(final.id).toBe(`sol-${i}`);
    }
  });

  it('guardiões rejeitam consistentemente tentativas de bypass nos 100 ataques', () => {
    for (let i = 0; i < 100; i++) {
      const s = novaRecebida(`acesso`, `ataque-${i}`);
      // Tentar pular direto para em_analise sem verificação
      expect(() => s.iniciarAnalise(T1)).toThrow(IdentidadeNaoVerificadaError);
      // Tentar confirmar de recebida (sem pendente_verificacao)
      expect(() => s.confirmarIdentidade(T1)).toThrow(IdentidadeNaoVerificadaError);
    }
  });
});
