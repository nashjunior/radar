import { describe, expect, it } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { RegistroUsoLlm } from '../../domain/registro-uso-llm.js';
import { UsoLlmInvalidoError } from '../../domain/errors/index.js';

const EDITAL = EditalId('edital-1');

function props(over: Partial<Parameters<typeof RegistroUsoLlm.criar>[0]> = {}) {
  return {
    editalId: EDITAL,
    tenantId: null,
    clienteFinalId: null,
    perfilId: null,
    modelo: 'claude-sonnet-5',
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    custoUsd: 0.006,
    ocorridoEm: new Date('2026-07-11T00:00:00Z'),
    coorteTrial: false,
    ...over,
  };
}

describe('RegistroUsoLlm (RAD-230, P-20/P-38)', () => {
  it('criar() aceita pré-extração GLOBAL (tenant/clienteFinal/perfil null — P-45)', () => {
    const registro = RegistroUsoLlm.criar(props());
    expect(registro.tenantId).toBeNull();
    expect(registro.clienteFinalId).toBeNull();
    expect(registro.perfilId).toBeNull();
    expect(registro.editalId).toBe(EDITAL);
  });

  it('criar() aceita escopo de tenant preenchido (cache-miss de TriarEditalUseCase)', () => {
    const registro = RegistroUsoLlm.criar(
      props({
        tenantId: TenantId('t1'),
        clienteFinalId: ClienteFinalId('c1'),
        perfilId: PerfilId('p1'),
      }),
    );
    expect(registro.tenantId).toBe(TenantId('t1'));
    expect(registro.clienteFinalId).toBe(ClienteFinalId('c1'));
    expect(registro.perfilId).toBe(PerfilId('p1'));
  });

  it('rejeita modelo vazio', () => {
    expect(() => RegistroUsoLlm.criar(props({ modelo: '  ' }))).toThrow(UsoLlmInvalidoError);
  });

  it.each(['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens', 'custoUsd'] as const)(
    'rejeita %s negativo',
    (campo) => {
      expect(() => RegistroUsoLlm.criar(props({ [campo]: -1 }))).toThrow(UsoLlmInvalidoError);
    },
  );

  it('rejeita custoUsd não-finito (NaN/Infinity — bug de contabilização)', () => {
    expect(() => RegistroUsoLlm.criar(props({ custoUsd: Number.NaN }))).toThrow(UsoLlmInvalidoError);
    expect(() => RegistroUsoLlm.criar(props({ custoUsd: Number.POSITIVE_INFINITY }))).toThrow(
      UsoLlmInvalidoError,
    );
  });

  it('aceita zero em todos os campos numéricos (chamada com custo/token zero é válida)', () => {
    expect(() =>
      RegistroUsoLlm.criar(
        props({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, custoUsd: 0 }),
      ),
    ).not.toThrow();
  });

  describe('coorteTrial (RAD-271, P-109 L1 — bulkhead de orçamento do coorte trial)', () => {
    it('aceita coorteTrial: true quando tenantId presente (cache-miss de tenant em trial)', () => {
      const registro = RegistroUsoLlm.criar(props({ tenantId: TenantId('t1'), coorteTrial: true }));
      expect(registro.coorteTrial).toBe(true);
    });

    it('rejeita coorteTrial: true sem tenantId — sem tenant não há coorte a classificar', () => {
      expect(() => RegistroUsoLlm.criar(props({ tenantId: null, coorteTrial: true }))).toThrow(
        UsoLlmInvalidoError,
      );
    });
  });
});
