/**
 * Testes unitários do guardrail de custo (RAD-243, P-20/P-38 admission control + orçamento).
 * Funções puras — sem I/O; os use cases (`extrair-edital.test.ts`/`triar-edital.test.ts`) cobrem
 * a orquestração (ledger + gateway) por cima destas.
 */
import { describe, expect, it } from 'vitest';
import {
  excedeOrcamento,
  excedeTetoDeAdmissao,
  inicioDaJanela,
  MAX_INPUT_TOKENS_ADMISSAO,
  POLITICA_ORCAMENTO_PADRAO,
} from '../../application/politica-orcamento.js';
import type { PoliticaOrcamento } from '../../application/politica-orcamento.js';

describe('excedeTetoDeAdmissao — sanity ceiling contra outliers', () => {
  it('inputTokens exatamente no teto NÃO excede (inclusivo por baixo)', () => {
    expect(excedeTetoDeAdmissao(MAX_INPUT_TOKENS_ADMISSAO)).toBe(false);
  });

  it('inputTokens 1 acima do teto excede', () => {
    expect(excedeTetoDeAdmissao(MAX_INPUT_TOKENS_ADMISSAO + 1)).toBe(true);
  });

  it('entrada pequena (edital normal) nunca excede', () => {
    expect(excedeTetoDeAdmissao(5_000)).toBe(false);
  });
});

describe('excedeOrcamento — orçamento acumulado por janela', () => {
  it('gasto + estimativa exatamente no teto NÃO excede (inclusivo)', () => {
    expect(excedeOrcamento(0.5, 9.5, 10)).toBe(false);
  });

  it('gasto + estimativa 1 centavo acima do teto excede', () => {
    expect(excedeOrcamento(0.51, 9.5, 10)).toBe(true);
  });

  it('sem gasto prévio, estimativa dentro do teto: não excede', () => {
    expect(excedeOrcamento(1, 0, 10)).toBe(false);
  });

  it('teto = Infinity (POLITICA_ORCAMENTO_PADRAO): nunca excede, qualquer gasto/estimativa', () => {
    expect(excedeOrcamento(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY)).toBe(
      false,
    );
  });
});

describe('POLITICA_ORCAMENTO_PADRAO — default sem teto (docs/98 P-20 [A VALIDAR])', () => {
  it('orcamentoGlobalUsd é Infinity — kill-switch inerte até Negócio+Eng ratificarem o número', () => {
    expect(POLITICA_ORCAMENTO_PADRAO.orcamentoGlobalUsd).toBe(Number.POSITIVE_INFINITY);
  });

  it('orcamentoPorTenantUsd é null — sem teto por tenant no default', () => {
    expect(POLITICA_ORCAMENTO_PADRAO.orcamentoPorTenantUsd).toBeNull();
  });

  it('orcamentoCoorteTrialUsd é null — sem teto do coorte trial no default (RAD-271)', () => {
    expect(POLITICA_ORCAMENTO_PADRAO.orcamentoCoorteTrialUsd).toBeNull();
  });
});

describe('inicioDaJanela — janela deslizante (rolling)', () => {
  it('subtrai janelaHoras convertida em ms a partir de `agora`', () => {
    const politica: PoliticaOrcamento = {
      janelaHoras: 24,
      orcamentoGlobalUsd: 10,
      orcamentoPorTenantUsd: null,
      orcamentoCoorteTrialUsd: null,
    };
    const agora = new Date('2026-07-11T12:00:00Z');
    const desde = inicioDaJanela(agora, politica);
    expect(desde.toISOString()).toBe('2026-07-10T12:00:00.000Z');
  });

  it('janela de 1 hora', () => {
    const politica: PoliticaOrcamento = {
      janelaHoras: 1,
      orcamentoGlobalUsd: 10,
      orcamentoPorTenantUsd: null,
      orcamentoCoorteTrialUsd: null,
    };
    const agora = new Date('2026-07-11T12:00:00Z');
    expect(inicioDaJanela(agora, politica).toISOString()).toBe('2026-07-11T11:00:00.000Z');
  });
});
