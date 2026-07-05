/**
 * Stress tests — domain VOs (adversarial / boundary)
 *
 * Eixo 1 — regras de negócio: invariantes dos VOs sob condições adversariais: NaN, Infinity,
 * valores-limite exatos e entradas malformadas que o código de produção pode receber via LLM
 * ou adapter de infra.
 *
 * Eixo 2 — critério de corte: exibivelComoFato e Aderencia.ehAlta verificam o comportamento
 * no limite exato dos limiares definidos em docs/10 §4 e P-19.
 */
import { describe, expect, it } from 'vitest';
import { EditalId, ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import { Aderencia } from '../../domain/value-objects/aderencia.js';
import { Confianca } from '../../domain/value-objects/confianca.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Requisito } from '../../domain/value-objects/requisito.js';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { Triagem } from '../../domain/triagem.js';
import {
  AderenciaInvalidaError,
  ConfiancaInvalidaError,
  CitacaoInvalidaError,
  RequisitoInvalidoError,
} from '../../domain/errors/index.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function campoObjeto(conf: number, citacao: Citacao | null = Citacao.criar(1, 'trecho')): CampoExtraido<string> {
  return CampoExtraido.criar({ valor: 'objeto', confianca: Confianca.criar(conf), citacao, critico: true });
}

function extracaoSimples(requisitos: Requisito[] = []): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EditalId('e1'),
    objeto: campoObjeto(0.9),
    valorEstimado: CampoExtraido.criar({ valor: 100, confianca: Confianca.criar(0.9), citacao: Citacao.criar(1, 'valor'), critico: true }),
    dataAberturaPropostas: CampoExtraido.criar({ valor: null, confianca: Confianca.criar(0.8), citacao: null, critico: false }),
    requisitos,
    riscosBrutos: [],
    paginas: 5,
  });
}

const PERFIL_VAZIO = PerfilHabilitacao.de({
  id: PerfilId('p1'),
  clienteFinalId: ClienteFinalId('c1'),
  habJuridica: [],
  habFiscal: ['CND'],
  habTecnica: [],
  habEconomica: [],
});

// ─── Aderencia ───────────────────────────────────────────────────────────────

describe('Aderencia — limites e entradas inválidas', () => {
  it('aceita 0 (limite inferior)', () => {
    expect(Aderencia.criar(0).valor).toBe(0);
  });

  it('aceita 1 (limite superior)', () => {
    expect(Aderencia.criar(1).valor).toBe(1);
  });

  it('rejeita valor negativo', () => {
    expect(() => Aderencia.criar(-0.001)).toThrow(AderenciaInvalidaError);
  });

  it('rejeita valor acima de 1', () => {
    expect(() => Aderencia.criar(1.001)).toThrow(AderenciaInvalidaError);
  });

  it('rejeita NaN — NaN bypass: NaN < 0 e NaN > 1 são ambos false em JS', () => {
    expect(() => Aderencia.criar(NaN)).toThrow(AderenciaInvalidaError);
  });

  it('rejeita +Infinity', () => {
    expect(() => Aderencia.criar(Infinity)).toThrow(AderenciaInvalidaError);
  });

  it('rejeita -Infinity', () => {
    expect(() => Aderencia.criar(-Infinity)).toThrow(AderenciaInvalidaError);
  });

  it('ehAlta = true em exatamente 0.7 (limiar inclusivo ≥ 0.7 — docs/10 §4)', () => {
    expect(Aderencia.criar(0.7).ehAlta).toBe(true);
  });

  it('ehAlta = false em 0.699... (just-below do limiar)', () => {
    // Ponto flutuante: maior representável abaixo de 0.7
    expect(Aderencia.criar(0.6999999999999999).ehAlta).toBe(false);
  });

  it('ehAlta = false em 0 (aderência nula)', () => {
    expect(Aderencia.criar(0).ehAlta).toBe(false);
  });

  it('ehAlta = true em 1 (aderência total)', () => {
    expect(Aderencia.criar(1).ehAlta).toBe(true);
  });
});

// ─── Confianca ───────────────────────────────────────────────────────────────

describe('Confianca — limites e entradas inválidas', () => {
  it('aceita 0 (limite inferior)', () => {
    expect(Confianca.criar(0).valor).toBe(0);
  });

  it('aceita 1 (limite superior)', () => {
    expect(Confianca.criar(1).valor).toBe(1);
  });

  it('rejeita NaN — NaN bypass idêntico ao de Aderencia', () => {
    expect(() => Confianca.criar(NaN)).toThrow(ConfiancaInvalidaError);
  });

  it('rejeita +Infinity', () => {
    expect(() => Confianca.criar(Infinity)).toThrow(ConfiancaInvalidaError);
  });

  it('rejeita -Infinity', () => {
    expect(() => Confianca.criar(-Infinity)).toThrow(ConfiancaInvalidaError);
  });

  it('suficiente() retorna true no limiar exato (>=)', () => {
    expect(Confianca.criar(0.5).suficiente(0.5)).toBe(true);
  });

  it('suficiente() retorna false 1 ULP abaixo do limiar', () => {
    // menor double representável abaixo de 0.5
    expect(Confianca.criar(0.4999999999999999).suficiente(0.5)).toBe(false);
  });

  it('menor() retorna o de menor valor — invariante de agregação (docs/10 §4)', () => {
    const alto = Confianca.criar(0.9);
    const baixo = Confianca.criar(0.3);
    expect(Confianca.menor(alto, baixo).valor).toBe(0.3);
    expect(Confianca.menor(baixo, alto).valor).toBe(0.3);
  });

  it('menor() com valores iguais retorna qualquer um (idempotente)', () => {
    const a = Confianca.criar(0.6);
    const b = Confianca.criar(0.6);
    expect(Confianca.menor(a, b).valor).toBe(0.6);
  });
});

// ─── Citacao ─────────────────────────────────────────────────────────────────

describe('Citacao — limites e entradas inválidas', () => {
  it('aceita página 1 (limite mínimo válido)', () => {
    expect(Citacao.criar(1, 'trecho').pagina).toBe(1);
  });

  it('rejeita página 0', () => {
    expect(() => Citacao.criar(0, 'trecho')).toThrow(CitacaoInvalidaError);
  });

  it('rejeita página negativa', () => {
    expect(() => Citacao.criar(-1, 'trecho')).toThrow(CitacaoInvalidaError);
  });

  it('rejeita NaN como página — NaN < 1 é false em JS', () => {
    expect(() => Citacao.criar(NaN, 'trecho')).toThrow(CitacaoInvalidaError);
  });

  it('rejeita trecho em branco', () => {
    expect(() => Citacao.criar(1, '   ')).toThrow(CitacaoInvalidaError);
  });

  it('rejeita trecho vazio', () => {
    expect(() => Citacao.criar(1, '')).toThrow(CitacaoInvalidaError);
  });

  it('trecho é trimado antes de validar e armazenar', () => {
    const c = Citacao.criar(1, '  algo  ');
    expect(c.trecho).toBe('algo');
  });
});

// ─── CampoExtraido ────────────────────────────────────────────────────────────

describe('CampoExtraido.exibivelComoFato — invariante de citação obrigatória (docs/10 §4)', () => {
  it('não é exibível como fato quando a citação é null, mesmo com confiança máxima', () => {
    const campo = CampoExtraido.criar({ valor: 'X', confianca: Confianca.criar(1), citacao: null, critico: true });
    expect(campo.exibivelComoFato(0)).toBe(false);
  });

  it('não é exibível quando a confiança está abaixo do limiar, mesmo com citação', () => {
    const campo = CampoExtraido.criar({
      valor: 'X',
      confianca: Confianca.criar(0.4),
      citacao: Citacao.criar(1, 'trecho'),
      critico: true,
    });
    expect(campo.exibivelComoFato(0.5)).toBe(false);
  });

  it('é exibível quando citação existe E confiança está no limiar exato', () => {
    const campo = CampoExtraido.criar({
      valor: 'X',
      confianca: Confianca.criar(0.5),
      citacao: Citacao.criar(1, 'trecho'),
      critico: false,
    });
    expect(campo.exibivelComoFato(0.5)).toBe(true);
  });

  it('null + confiança baixa: duplo bloqueio', () => {
    const campo = CampoExtraido.criar({ valor: 'X', confianca: Confianca.criar(0.1), citacao: null, critico: true });
    expect(campo.exibivelComoFato(0.5)).toBe(false);
  });
});

// ─── Requisito ────────────────────────────────────────────────────────────────

describe('Requisito — validação de entradas', () => {
  it('rejeita descrição em branco', () => {
    expect(() => Requisito.criar('fiscal', '   ', null)).toThrow(RequisitoInvalidoError);
  });

  it('rejeita descrição vazia', () => {
    expect(() => Requisito.criar('juridica', '', null)).toThrow(RequisitoInvalidoError);
  });

  it('aceita todas as categorias de habilitação válidas', () => {
    const cats = ['juridica', 'fiscal', 'tecnica', 'economica'] as const;
    for (const cat of cats) {
      expect(() => Requisito.criar(cat, 'doc', null)).not.toThrow();
    }
  });
});

// ─── Triagem.avaliar — limiar de recomendação ─────────────────────────────────

describe('Triagem.avaliar — limiar go/no-go em aderência exata 0.7', () => {
  const TENANT = TenantId('global');

  function perfilParcial(atendidos: number, total: number): PerfilHabilitacao {
    const habs = Array.from({ length: atendidos }, (_, i) => `doc-${i}`);
    const reqs = Array.from({ length: total }, (_, i) => `doc-${i}`);
    // coloca os atendidos em fiscal, o resto como tecnica (lacunas)
    const lacunas = reqs.slice(atendidos);
    const p = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: [],
      habFiscal: habs,
      habTecnica: [],
      habEconomica: [],
    });
    return p;
  }

  it('go quando aderência é exatamente 0.7 (7 de 10 requisitos atendidos)', () => {
    // 7 requisitos fiscais atendidos + 3 técnicos em lacuna = 7/10 = 0.7
    const reqs: Requisito[] = [
      ...Array.from({ length: 7 }, (_, i) => Requisito.criar('fiscal', `doc-${i}`, null)),
      ...Array.from({ length: 3 }, (_, i) => Requisito.criar('tecnica', `req-tec-${i}`, null)),
    ];
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: [],
      habFiscal: Array.from({ length: 7 }, (_, i) => `doc-${i}`),
      habTecnica: [],
      habEconomica: [],
    });
    const triagem = Triagem.avaliar(extracaoSimples(reqs), perfil, TENANT);
    expect(triagem.aderencia.valor).toBeCloseTo(0.7);
    expect(triagem.recomendacao).toBe('go');
  });

  it('no-go quando aderência é 6/10 (< 0.7)', () => {
    const reqs: Requisito[] = [
      ...Array.from({ length: 6 }, (_, i) => Requisito.criar('fiscal', `doc-${i}`, null)),
      ...Array.from({ length: 4 }, (_, i) => Requisito.criar('tecnica', `req-tec-${i}`, null)),
    ];
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: [],
      habFiscal: Array.from({ length: 6 }, (_, i) => `doc-${i}`),
      habTecnica: [],
      habEconomica: [],
    });
    const triagem = Triagem.avaliar(extracaoSimples(reqs), perfil, TENANT);
    expect(triagem.aderencia.valor).toBeCloseTo(0.6);
    expect(triagem.recomendacao).toBe('no-go');
  });

  it('go quando aderência é 1.0 (todos atendidos)', () => {
    const reqs = [Requisito.criar('fiscal', 'CND', null)];
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: [],
      habFiscal: ['CND'],
      habTecnica: [],
      habEconomica: [],
    });
    const triagem = Triagem.avaliar(extracaoSimples(reqs), perfil, TENANT);
    expect(triagem.aderencia.valor).toBe(1);
    expect(triagem.recomendacao).toBe('go');
  });

  it('clienteFinalId da Triagem vem do perfil, nunca de outro objeto (IDOR — P-51)', () => {
    const CLIENTE = ClienteFinalId('c-correto');
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: CLIENTE,
      habJuridica: [],
      habFiscal: [],
      habTecnica: [],
      habEconomica: [],
    });
    const triagem = Triagem.avaliar(extracaoSimples([]), perfil, TENANT);
    expect(triagem.clienteFinalId).toBe(CLIENTE);
  });
});

// ─── PerfilHabilitacao.confrontar — edge cases de matching ───────────────────

describe('PerfilHabilitacao.confrontar — edge cases adversariais', () => {
  it('habilitação com string de subconjunto atende o requisito mais genérico (substring)', () => {
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: [],
      habFiscal: ['CND'],
      habTecnica: [],
      habEconomica: [],
    });
    // "Certidão CND" contém "CND" — deve atender (normalização MVP)
    const { aderencia } = perfil.confrontar([Requisito.criar('fiscal', 'Certidão CND', null)]);
    expect(aderencia.valor).toBe(1);
  });

  it('correspondência é insensível a acentos e caixa', () => {
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: ['Contrato Social'],
      habFiscal: [],
      habTecnica: [],
      habEconomica: [],
    });
    const { aderencia } = perfil.confrontar([Requisito.criar('juridica', 'contrato social', null)]);
    expect(aderencia.valor).toBe(1);
  });

  it('lista de habilitação com entradas de string vazia não quebra o matching', () => {
    // Infra pode passar lista com strings vazias — o atendeRequisito() retorna false mas não joga
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: [],
      habFiscal: ['', 'CND'],
      habTecnica: [],
      habEconomica: [],
    });
    expect(() =>
      perfil.confrontar([Requisito.criar('fiscal', 'CND', null)]),
    ).not.toThrow();
    const { aderencia } = perfil.confrontar([Requisito.criar('fiscal', 'CND', null)]);
    expect(aderencia.valor).toBe(1);
  });

  it('aderência é sempre ≥ 0 e ≤ 1 para qualquer entrada válida (invariante de VO)', () => {
    const perfil = PerfilHabilitacao.de({
      id: PerfilId('p1'),
      clienteFinalId: ClienteFinalId('c1'),
      habJuridica: [],
      habFiscal: [],
      habTecnica: [],
      habEconomica: [],
    });
    // 1 requisito → aderência 0/1 = 0 (não atende)
    const { aderencia } = perfil.confrontar([Requisito.criar('tecnica', 'CREA', null)]);
    expect(aderencia.valor).toBeGreaterThanOrEqual(0);
    expect(aderencia.valor).toBeLessThanOrEqual(1);
  });
});
