import { describe, expect, it } from 'vitest';
import { ClienteFinalId, PerfilId } from '@radar/kernel';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import type { PerfilHabilitacaoProps } from '../../domain/perfil-habilitacao.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Requisito } from '../../domain/value-objects/requisito.js';

const PERFIL = PerfilId('perfil-1');
const CLIENTE = ClienteFinalId('cliente-1');

function perfil(over?: Partial<PerfilHabilitacaoProps>): PerfilHabilitacao {
  return PerfilHabilitacao.de({
    id: PERFIL,
    clienteFinalId: CLIENTE,
    habJuridica: ['Contrato social'],
    habFiscal: ['CND', 'FGTS'],
    habTecnica: ['Atestado de capacidade técnica'],
    habEconomica: ['Balanço patrimonial'],
    ...over,
  });
}

describe('PerfilHabilitacao.confrontar (A17 §3.3)', () => {
  it('aderência 1 e nenhum risco quando o perfil atende todos os requisitos', () => {
    const { aderencia, riscos } = perfil().confrontar([
      Requisito.criar('fiscal', 'Certidão CND', Citacao.criar(4, 'exige CND', '7.1')),
      Requisito.criar('juridica', 'Contrato social', null),
    ]);
    expect(aderencia.valor).toBe(1);
    expect(riscos).toHaveLength(0);
  });

  it('casa por normalização (acentos/caixa) — "Certidão CND" ~ "CND"', () => {
    const { aderencia } = perfil().confrontar([
      Requisito.criar('fiscal', 'Certidão CND', null),
    ]);
    expect(aderencia.valor).toBe(1);
  });

  it('gera risco para a lacuna, com a citação HERDADA do requisito de origem', () => {
    const { aderencia, riscos } = perfil({ habTecnica: [] }).confrontar([
      Requisito.criar('fiscal', 'Certidão CND', null), // atende
      Requisito.criar('tecnica', 'Registro CREA', Citacao.criar(5, 'registro no CREA', '8')), // lacuna
    ]);
    expect(aderencia.valor).toBeCloseTo(0.5);
    expect(riscos).toHaveLength(1);
    expect(riscos[0]!.descricao).toBe('não atende: Registro CREA');
    expect(riscos[0]!.severidade).toBe('media'); // técnica → média
    expect(riscos[0]!.citacao?.pagina).toBe(5); // mesma citação do requisito
  });

  it('severidade por categoria: jurídica/fiscal alta, econômica baixa', () => {
    const vazio = perfil({ habJuridica: [], habFiscal: [], habTecnica: [], habEconomica: [] });
    const { riscos } = vazio.confrontar([
      Requisito.criar('juridica', 'Contrato social', null),
      Requisito.criar('economica', 'Balanço patrimonial', null),
    ]);
    expect(riscos.find((r) => r.descricao.includes('Contrato'))!.severidade).toBe('alta');
    expect(riscos.find((r) => r.descricao.includes('Balanço'))!.severidade).toBe('baixa');
  });

  it('sem requisitos, aderência é 0 (nada a confrontar não é "apto" — A17 §6)', () => {
    const { aderencia, riscos } = perfil().confrontar([]);
    expect(aderencia.valor).toBe(0);
    expect(riscos).toHaveLength(0);
  });
});
