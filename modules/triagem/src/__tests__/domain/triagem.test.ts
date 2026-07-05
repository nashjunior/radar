import { describe, expect, it } from 'vitest';
import { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import { Triagem } from '../../domain/triagem.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';
import { Requisito } from '../../domain/value-objects/requisito.js';

const EDITAL = EditalId('edital-1');
const PERFIL = PerfilId('perfil-1');
const CLIENTE = ClienteFinalId('cliente-1');
const TENANT = TenantId('global');

function campo<T>(valor: T): CampoExtraido<T> {
  return CampoExtraido.criar({
    valor,
    confianca: Confianca.criar(0.9),
    citacao: Citacao.criar(1, 'trecho'),
    critico: true,
  });
}

function extracao(requisitos: Requisito[]): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EDITAL,
    objeto: campo('Aquisição de notebooks'),
    valorEstimado: campo<number | null>(250000),
    dataAberturaPropostas: campo<Date | null>(null),
    requisitos,
    riscosBrutos: [],
    paginas: 10,
  });
}

const perfil = PerfilHabilitacao.de({
  id: PERFIL,
  clienteFinalId: CLIENTE,
  habJuridica: ['Contrato social'],
  habFiscal: ['CND'],
  habTecnica: ['Atestado técnico'],
  habEconomica: ['Balanço'],
});

describe('Triagem.avaliar (write path — A17 §3.3/§4.3)', () => {
  it('recomenda "go" quando a aderência é alta (≥ 0.7) e escopa ao perfil/tenant', () => {
    const triagem = Triagem.avaliar(
      extracao([Requisito.criar('fiscal', 'Certidão CND', null)]),
      perfil,
      TENANT,
    );
    expect(triagem.aderencia.valor).toBe(1);
    expect(triagem.recomendacao).toBe('go');
    expect(triagem.editalId).toBe(EDITAL);
    expect(triagem.perfilId).toBe(PERFIL);
    expect(triagem.tenantId).toBe(TENANT);
    expect(triagem.clienteFinalId).toBe(CLIENTE); // vem do perfil — fecha o escopo por objeto
    expect(triagem.riscos).toHaveLength(0);
  });

  it('recomenda "no-go" quando a aderência é baixa e carrega os riscos das lacunas', () => {
    const triagem = Triagem.avaliar(
      extracao([
        Requisito.criar('fiscal', 'Certidão CND', null), // atende
        Requisito.criar('tecnica', 'Registro CREA', null), // lacuna
      ]),
      perfil,
      TENANT,
    );
    expect(triagem.aderencia.valor).toBeCloseTo(0.5);
    expect(triagem.recomendacao).toBe('no-go');
    expect(triagem.riscos.map((r) => r.descricao)).toEqual(['não atende: Registro CREA']);
  });
});
