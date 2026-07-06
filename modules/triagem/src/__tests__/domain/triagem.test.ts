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

describe('Triagem — factory methods de estados degradados (RAD-79)', () => {
  it('pendente() cria status processando com aderência/recomendação nulas e riscos vazios', () => {
    const t = Triagem.pendente(EDITAL, PERFIL, TENANT, CLIENTE);
    expect(t.status).toBe('processando');
    expect(t.aderencia).toBeNull();
    expect(t.recomendacao).toBeNull();
    expect(t.riscos).toHaveLength(0);
  });

  it('incompleta() cria status incompleta com aderência nula (confiança abaixo do limiar)', () => {
    const t = Triagem.incompleta(EDITAL, PERFIL, TENANT, CLIENTE);
    expect(t.status).toBe('incompleta');
    expect(t.aderencia).toBeNull();
    expect(t.recomendacao).toBeNull();
  });

  it('falhaOcr() cria status falha_ocr com aderência nula', () => {
    const t = Triagem.falhaOcr(EDITAL, PERFIL, TENANT, CLIENTE);
    expect(t.status).toBe('falha_ocr');
    expect(t.aderencia).toBeNull();
  });

  it('recusada() cria status recusada com aderência nula', () => {
    const t = Triagem.recusada(EDITAL, PERFIL, TENANT, CLIENTE);
    expect(t.status).toBe('recusada');
    expect(t.aderencia).toBeNull();
  });

  it('todos os estados degradados escopo corretamente o tenantId e clienteFinalId', () => {
    const factories = [
      Triagem.pendente(EDITAL, PERFIL, TENANT, CLIENTE),
      Triagem.incompleta(EDITAL, PERFIL, TENANT, CLIENTE),
      Triagem.falhaOcr(EDITAL, PERFIL, TENANT, CLIENTE),
      Triagem.recusada(EDITAL, PERFIL, TENANT, CLIENTE),
    ];
    for (const t of factories) {
      expect(t.tenantId).toBe(TENANT);
      expect(t.clienteFinalId).toBe(CLIENTE);
      expect(t.editalId).toBe(EDITAL);
      expect(t.perfilId).toBe(PERFIL);
    }
  });
});

describe('Triagem.avaliar (write path — A17 §3.3/§4.3)', () => {
  it('sempre produz status concluida com aderência e recomendação não-nulas', () => {
    const triagem = Triagem.avaliar(
      extracao([]),
      perfil,
      TENANT,
    );
    expect(triagem.status).toBe('concluida');
    expect(triagem.aderencia).not.toBeNull();
    expect(triagem.recomendacao).not.toBeNull();
  });

  it('recomenda "go" quando a aderência é alta (≥ 0.7) e escopa ao perfil/tenant', () => {
    const triagem = Triagem.avaliar(
      extracao([Requisito.criar('fiscal', 'Certidão CND', null)]),
      perfil,
      TENANT,
    );
    expect(triagem.aderencia!.valor).toBe(1);
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
    expect(triagem.aderencia!.valor).toBeCloseTo(0.5);
    expect(triagem.recomendacao).toBe('no-go');
    expect(triagem.riscos.map((r) => r.descricao)).toEqual(['não atende: Registro CREA']);
  });
});
