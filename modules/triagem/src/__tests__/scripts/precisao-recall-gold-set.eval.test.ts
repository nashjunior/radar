/**
 * Eval de PRECISÃO/RECALL — Gold Set Sintético (RAD-204 · A16 §2.4 · docs/07 §6)
 *
 * Roda o pipeline REAL de extração (AnthropicLlmGateway → montarRequisicaoExtracao →
 * interpretarSaidaExtracao, camadas 1–6) contra FIXTURES SINTETIZADAS a partir dos rótulos
 * do gold set, SEM ANTHROPIC_API_KEY e SEM rede. Reporta precisão/recall por campo crítico
 * e valida os gates de release (docs/07 §6 linha 68):
 *   — recall ≥ 95% nos campos críticos (objeto, valorEstimado, dataAberturaPropostas)
 *   — zero alucinação numérica (valorEstimado, dataAberturaPropostas) ao limiar de produção
 *
 * Seam: RecordReplayLlmClient (A17 §7 · RAD-140). Rótulos: gold set sintético 30 editais
 * (scripts/fixtures/gold-set-rotulado-sintetico.json). Substituir pelo gold set REAL quando
 * P-18/P-84/P-85 fecharem. Encaixa no framework de eval P-85 e no red-team P-72 (Iara).
 *
 * Definição de métricas — alinhada com calibracao-limiar.ts (P-19 · A16 §2.4):
 *   total     = count(critico=true AND rotuloPresente=true)  [denominador do recall]
 *   tp        = count(total AND surfaced AND extraidoCorreto=true)
 *   fp        = count(surfaced AND extraidoCorreto=false)
 *   fn        = total − tp
 *   recall    = tp / total
 *   precisao  = tp / (tp + fp);  1.0 quando nada surfaced
 *   aluc.num  = count(fp AND numerico=true)  [deve ser 0 — gate docs/07 §6 critério 4]
 *
 * onde "surfaced" = CampoExtraido.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  AnthropicLlmGateway,
  montarRequisicaoExtracao,
} from '../../infra/adapters/anthropic-llm-gateway.js';
import {
  RecordReplayLlmClient,
  chavePorConteudo,
} from '../../infra/adapters/record-replay-llm-client.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';
import type { GoldSet, EditalRotulado } from '../../application/calibracao-limiar.js';
import { LIMIAR_CONFIANCA_PADRAO } from '../../application/politica-confianca.js';
import type { ExtracaoEdital } from '../../domain/extracao-edital.js';

// ─── gold set ─────────────────────────────────────────────────────────────────

const GOLD_SET_PATH = resolve(
  __dirname,
  '../../../scripts/fixtures/gold-set-rotulado-sintetico.json',
);

function carregarGoldSet(): GoldSet {
  return JSON.parse(readFileSync(GOLD_SET_PATH, 'utf8')) as GoldSet;
}

// ─── síntese de texto e fixture LLM ──────────────────────────────────────────

/**
 * Texto determinístico por edital. As frases-âncora por campo são exatas o suficiente para
 * que bindCitacao (camada 6) as encontre no texto normalizado (sem diacríticos, minúsculo).
 */
function textoSintetico(id: string): string {
  return [
    `EDITAL ${id.toUpperCase()}`,
    `OBJETO: fornecimento de equipamentos ${id}.`,
    `VALOR ESTIMADO: R$ 100000 referente a ${id}.`,
    `DATA ABERTURA: 2026-10-01 sessao ${id}.`,
    `HABILITACAO: certidao fiscal requerida ${id}.`,
  ].join('\n');
}

type CitacaoRaw = { pagina: number; secao: null; trecho: string };

function cit(trecho: string): CitacaoRaw {
  return { pagina: 1, secao: null, trecho };
}

/**
 * Fixture LLM para um edital do gold set. A citação sempre aponta para uma frase presente no
 * textoSintetico do mesmo edital, garantindo que bindCitacao passe (citacao != null). O valor
 * retornado implementa o rótulo extraidoCorreto/rotuloPresente do gold set:
 *   — extraidoCorreto=true  → valor "correto" com citação válida
 *   — extraidoCorreto=false → valor errado com citação válida (simulação de alucinação)
 *   — rotuloPresente=false  → null sem citação (LLM acertou a ausência)
 */
function fixtureLlm(edital: EditalRotulado): unknown {
  const { id, campos } = edital;

  return {
    objeto: {
      valor: campos.objeto.extraidoCorreto
        ? `fornecimento de equipamentos ${id}`
        : `descricao incorreta ${id}`,
      confianca: campos.objeto.confianca,
      citacao: cit(`fornecimento de equipamentos ${id}`),
    },
    valorEstimado: {
      valor: !campos.valorEstimado.rotuloPresente
        ? null
        : campos.valorEstimado.extraidoCorreto
          ? 100000
          : 999999,
      confianca: campos.valorEstimado.confianca,
      citacao: campos.valorEstimado.rotuloPresente
        ? cit(`r$ 100000 referente a ${id}`)
        : null,
    },
    dataAberturaPropostas: {
      valor: !campos.dataAberturaPropostas.rotuloPresente
        ? null
        : campos.dataAberturaPropostas.extraidoCorreto
          ? '2026-10-01'
          : '1900-01-01',
      confianca: campos.dataAberturaPropostas.confianca,
      citacao: campos.dataAberturaPropostas.rotuloPresente
        ? cit(`2026-10-01 sessao ${id}`)
        : null,
    },
    requisitos: [
      {
        categoria: 'fiscal',
        descricao: `certidao fiscal requerida ${id}`,
        citacao: cit(`certidao fiscal requerida ${id}`),
      },
    ],
    riscos: [],
  };
}

// ─── pipeline runner ──────────────────────────────────────────────────────────

type Resultado = { edital: EditalRotulado; extracao: ExtracaoEdital };

async function runPipeline(goldSet: GoldSet): Promise<Resultado[]> {
  const fixtureMap = new Map<string, unknown>();
  const entradas = new Map<string, EntradaExtracaoDTO>();

  for (const edital of goldSet.editais) {
    const entrada: EntradaExtracaoDTO = {
      editalId: edital.id,
      texto: textoSintetico(edital.id),
      temTextoSelecionavel: true,
      anexos: [],
      paginas: 1,
    };
    const chave = chavePorConteudo(montarRequisicaoExtracao(entrada));
    fixtureMap.set(chave, fixtureLlm(edital));
    entradas.set(edital.id, entrada);
  }

  const gateway = new AnthropicLlmGateway(new RecordReplayLlmClient(fixtureMap));
  const signal = new AbortController().signal;

  return Promise.all(
    goldSet.editais.map(async (edital) => {
      const extracao = await gateway.extrair(entradas.get(edital.id)!, signal);
      return { edital, extracao };
    }),
  );
}

// ─── metrics ──────────────────────────────────────────────────────────────────

type CampoNome = 'objeto' | 'valorEstimado' | 'dataAberturaPropostas';

interface MetricasCampo {
  campo: string;
  total: number;
  tp: number;
  fp: number;
  fn: number;
  alucinacoesNumericas: number;
  recall: number;
  precisao: number;
}

function computarMetricasCampo(
  resultados: Resultado[],
  campoNome: CampoNome,
  limiar: number,
): MetricasCampo {
  let total = 0,
    tp = 0,
    fp = 0,
    alucinacoesNumericas = 0;

  for (const { edital, extracao } of resultados) {
    const label = edital.campos[campoNome];
    if (!label.critico) continue;

    const surfaced = extracao[campoNome].exibivelComoFato(limiar);

    if (label.rotuloPresente) {
      total++;
      if (surfaced && label.extraidoCorreto) tp++;
    }

    if (surfaced && !label.extraidoCorreto) {
      fp++;
      if (label.numerico) alucinacoesNumericas++;
    }
  }

  const fn = total - tp;
  const recall = total > 0 ? tp / total : 0;
  const precisao = tp + fp > 0 ? tp / (tp + fp) : 1;
  return { campo: campoNome, total, tp, fp, fn, alucinacoesNumericas, recall, precisao };
}

function computarMetricasGlobal(por_campo: MetricasCampo[]): MetricasCampo {
  const total = por_campo.reduce((s, m) => s + m.total, 0);
  const tp = por_campo.reduce((s, m) => s + m.tp, 0);
  const fp = por_campo.reduce((s, m) => s + m.fp, 0);
  const fn = por_campo.reduce((s, m) => s + m.fn, 0);
  const alucinacoesNumericas = por_campo.reduce((s, m) => s + m.alucinacoesNumericas, 0);
  const recall = total > 0 ? tp / total : 0;
  const precisao = tp + fp > 0 ? tp / (tp + fp) : 1;
  return { campo: 'GLOBAL', total, tp, fp, fn, alucinacoesNumericas, recall, precisao };
}

// ─── relatório ────────────────────────────────────────────────────────────────

const GATE_RECALL = 0.95;
const GATE_PRECISAO = 0.9;

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function imprimirRelatorio(por_campo: MetricasCampo[], global: MetricasCampo): void {
  const cols = ['campo'.padEnd(22), 'total', '  TP', '  FP', '  FN', 'recall ', 'precisao', 'aluc.num'];
  const sep = '─'.repeat(80);

  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log(`║  EVAL PRECISÃO/RECALL — Gold Set Sintético · RAD-204 (A16 §2.4 · docs/07 §6) ║`);
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝');
  console.log(`Harness: RecordReplay (sem LLM ao vivo)  |  LIMIAR = ${LIMIAR_CONFIANCA_PADRAO}  |  Editais: 30`);
  console.log(sep);
  console.log(cols.join('  '));
  console.log(sep);

  for (const m of [...por_campo, global]) {
    const marker = m.campo === 'GLOBAL' ? '▶ ' : '  ';
    console.log(
      [
        `${marker}${m.campo}`.padEnd(22),
        String(m.total).padStart(5),
        String(m.tp).padStart(4),
        String(m.fp).padStart(4),
        String(m.fn).padStart(4),
        pct(m.recall).padStart(7),
        pct(m.precisao).padStart(8),
        String(m.alucinacoesNumericas).padStart(8),
      ].join('  '),
    );
  }

  console.log(sep);
  const recallOk = global.recall >= GATE_RECALL;
  const precisaoOk = global.precisao >= GATE_PRECISAO;
  const alucinacaoOk = global.alucinacoesNumericas === 0;
  console.log(
    `Gate recall ≥ ${pct(GATE_RECALL)} [docs/07 §6]: ${pct(global.recall)} ${recallOk ? '✓' : '✗ FALHOU'}`,
  );
  console.log(
    `Gate precisão ≥ ${pct(GATE_PRECISAO)}          : ${pct(global.precisao)} ${precisaoOk ? '✓' : '✗ FALHOU'}`,
  );
  console.log(
    `Gate alucinação numérica = 0     : ${global.alucinacoesNumericas} ${alucinacaoOk ? '✓' : '✗ FALHOU'}`,
  );
  console.log('');
}

// ─── state compartilhado ──────────────────────────────────────────────────────

let resultados: Resultado[];
let metricasObjeto: MetricasCampo;
let metricasValor: MetricasCampo;
let metricasData: MetricasCampo;
let metricasGlobal: MetricasCampo;
const goldSet = carregarGoldSet();

beforeAll(async () => {
  resultados = await runPipeline(goldSet);
  metricasObjeto = computarMetricasCampo(resultados, 'objeto', LIMIAR_CONFIANCA_PADRAO);
  metricasValor = computarMetricasCampo(resultados, 'valorEstimado', LIMIAR_CONFIANCA_PADRAO);
  metricasData = computarMetricasCampo(resultados, 'dataAberturaPropostas', LIMIAR_CONFIANCA_PADRAO);
  metricasGlobal = computarMetricasGlobal([metricasObjeto, metricasValor, metricasData]);
  imprimirRelatorio([metricasObjeto, metricasValor, metricasData], metricasGlobal);
});

// ─── testes ───────────────────────────────────────────────────────────────────

describe('harness RecordReplay — sem ANTHROPIC_API_KEY, sem rede', () => {
  it('carrega o gold set sintético (30 editais)', () => {
    expect(goldSet.editais).toHaveLength(30);
    expect(goldSet.meta.tipo).toBe('sintetico');
  });

  it('extrai todos os 30 editais via pipeline REAL sem exceção', () => {
    expect(resultados).toHaveLength(30);
    for (const { extracao } of resultados) {
      expect(extracao.objeto.valor).toBeTruthy();
    }
  });

  it('edital adversarial gs-029: nenhum campo surfaced (todos abaixo do limiar)', () => {
    const r = resultados.find((x) => x.edital.id === 'gs-029')!;
    expect(r.extracao.objeto.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
    expect(r.extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
    expect(r.extracao.dataAberturaPropostas.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
  });

  it('gs-028 (confiança = 0,70 exato): todos os campos surfaced (limiar >= é inclusivo)', () => {
    const r = resultados.find((x) => x.edital.id === 'gs-028')!;
    expect(r.extracao.objeto.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
    expect(r.extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
    expect(r.extracao.dataAberturaPropostas.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
  });

  it('gs-004, gs-009, gs-015 (valorEstimado ausente): campo valorEstimado NOT surfaced', () => {
    for (const id of ['gs-004', 'gs-009', 'gs-015']) {
      const r = resultados.find((x) => x.edital.id === id)!;
      expect(r.extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
      expect(r.extracao.valorEstimado.valor).toBeNull();
    }
  });

  it('gs-030 (valorEstimado errado, conf 0.65): campo NOT surfaced — zero alucinação numérica', () => {
    const r = resultados.find((x) => x.edital.id === 'gs-030')!;
    expect(r.extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
  });

  it('citação está ligada (não-nula) para campos surfaced', () => {
    for (const { extracao } of resultados) {
      if (extracao.objeto.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)) {
        expect(extracao.objeto.citacao).not.toBeNull();
      }
      if (extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)) {
        expect(extracao.valorEstimado.citacao).not.toBeNull();
      }
      if (extracao.dataAberturaPropostas.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)) {
        expect(extracao.dataAberturaPropostas.citacao).not.toBeNull();
      }
    }
  });

  it('cada ExtracaoEdital tem ao menos um requisito de habilitação (fiscal)', () => {
    for (const { extracao } of resultados) {
      expect(extracao.requisitos.length).toBeGreaterThanOrEqual(1);
      expect(extracao.requisitos[0]!.categoria).toBe('fiscal');
    }
  });
});

describe('gates de release — docs/07 §6', () => {
  it('recall GLOBAL ≥ 95% (gate release docs/07 §6)', () => {
    expect(metricasGlobal.recall).toBeGreaterThanOrEqual(GATE_RECALL);
  });

  it('zero alucinação numérica GLOBAL — critério 4 gate docs/07 §6', () => {
    expect(metricasGlobal.alucinacoesNumericas).toBe(0);
  });

  it('precisão GLOBAL ≥ 90%', () => {
    expect(metricasGlobal.precisao).toBeGreaterThanOrEqual(GATE_PRECISAO);
  });

  it('recall objeto ≥ 95%', () => {
    expect(metricasObjeto.recall).toBeGreaterThanOrEqual(GATE_RECALL);
  });

  it('recall dataAberturaPropostas (prazo) ≥ 95%', () => {
    expect(metricasData.recall).toBeGreaterThanOrEqual(GATE_RECALL);
  });

  it('zero alucinação numérica em valorEstimado', () => {
    expect(metricasValor.alucinacoesNumericas).toBe(0);
  });

  it('zero alucinação numérica em dataAberturaPropostas', () => {
    expect(metricasData.alucinacoesNumericas).toBe(0);
  });

  it('métricas globais batem com resultado do calibrar-limiar @0,70: recall ≈ 95,4%', () => {
    // Verificação de regressão: se os rótulos mudarem, este teste avisará.
    expect(metricasGlobal.total).toBe(87);
    expect(metricasGlobal.tp).toBe(83);
    expect(metricasGlobal.fp).toBe(0);
    expect(metricasGlobal.fn).toBe(4);
    expect(metricasGlobal.recall).toBeCloseTo(0.954, 2);
  });
});

describe('stress — adversarial e edge cases', () => {
  it('adversarial (gs-029): LLM retorna valores errados em todos os campos — nenhum surfaced', () => {
    const r = resultados.find((x) => x.edital.id === 'gs-029')!;
    // Verifica que o valor inventado NÃO é surfaced (confiança abaixo do limiar)
    expect(r.extracao.objeto.confianca.valor).toBeCloseTo(0.58, 2);
    expect(r.extracao.valorEstimado.confianca.valor).toBeCloseTo(0.62, 2);
    expect(r.extracao.dataAberturaPropostas.confianca.valor).toBeCloseTo(0.48, 2);
    // Nenhum campo foi surfaced
    expect(r.extracao.objeto.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
    expect(r.extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
    expect(r.extracao.dataAberturaPropostas.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
  });

  it('adversarial (gs-030): valorEstimado errado (conf 0,65) abaixo do limiar → zero aluc.num', () => {
    const r = resultados.find((x) => x.edital.id === 'gs-030')!;
    expect(r.extracao.valorEstimado.confianca.valor).toBeCloseTo(0.65, 2);
    expect(r.extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(false);
    // objeto e data foram surfaced corretamente
    expect(r.extracao.objeto.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
    expect(r.extracao.dataAberturaPropostas.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
  });

  it('limiar exato 0,70 (gs-028): todos os 3 campos na fronteira — todos surfaced (>= é inclusivo)', () => {
    const r = resultados.find((x) => x.edital.id === 'gs-028')!;
    expect(r.extracao.objeto.confianca.valor).toBeCloseTo(0.7, 2);
    expect(r.extracao.valorEstimado.confianca.valor).toBeCloseTo(0.7, 2);
    expect(r.extracao.dataAberturaPropostas.confianca.valor).toBeCloseTo(0.7, 2);
    expect(r.extracao.objeto.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
    expect(r.extracao.valorEstimado.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
    expect(r.extracao.dataAberturaPropostas.exibivelComoFato(LIMIAR_CONFIANCA_PADRAO)).toBe(true);
  });

  it('limiar 0,69 (justo abaixo): gs-028 desaparece do conjunto surfaced', () => {
    const r = resultados.find((x) => x.edital.id === 'gs-028')!;
    expect(r.extracao.objeto.exibivelComoFato(0.69)).toBe(true); // 0.70 >= 0.69
    expect(r.extracao.objeto.exibivelComoFato(0.71)).toBe(false); // 0.70 < 0.71
  });

  it('recall sobe ao reduzir o limiar para 0,50: todos os campos críticos presentes são surfaced', () => {
    const metricasRelaxadas = computarMetricasCampo(resultados, 'objeto', 0.5);
    // Com limiar=0.50, até gs-029 (conf=0.58) seria surfaced (mas extraidoCorreto=false → não TP)
    // Total = 30, mas gs-029 tem extraidoCorreto=false → TP = 29, FP = 1
    expect(metricasRelaxadas.tp).toBe(29);
    expect(metricasRelaxadas.fp).toBe(1); // gs-029 objeto surfaced mas errado
  });

  it('recall cai para 0% ao elevar o limiar para 1,00: nenhum campo passa', () => {
    const metricasEstrito = computarMetricasGlobal([
      computarMetricasCampo(resultados, 'objeto', 1.0),
      computarMetricasCampo(resultados, 'valorEstimado', 1.0),
      computarMetricasCampo(resultados, 'dataAberturaPropostas', 1.0),
    ]);
    expect(metricasEstrito.tp).toBe(0);
    expect(metricasEstrito.recall).toBe(0);
  });

  it('editais imagem (gs-014, gs-015, gs-016, gs-021, gs-026): pipeline extrai normalmente', () => {
    for (const id of ['gs-014', 'gs-015', 'gs-016', 'gs-021', 'gs-026']) {
      const r = resultados.find((x) => x.edital.id === id)!;
      expect(r.extracao.objeto.valor).toContain(id);
    }
  });

  it('FixtureDeGoldSetAusenteError ao tentar extrair edital sem fixture registrada', async () => {
    const emptyClient = new RecordReplayLlmClient(new Map());
    const gateway = new AnthropicLlmGateway(emptyClient);
    const entrada: EntradaExtracaoDTO = {
      editalId: 'nao-existe',
      texto: 'texto qualquer',
      temTextoSelecionavel: true,
      anexos: [],
      paginas: 1,
    };
    const { FixtureDeGoldSetAusenteError } = await import(
      '../../infra/adapters/record-replay-llm-client.js'
    );
    await expect(gateway.extrair(entrada, new AbortController().signal)).rejects.toBeInstanceOf(
      FixtureDeGoldSetAusenteError,
    );
  });

  it('pipeline determinístico: resultado idêntico ao re-executar o mesmo edital', async () => {
    const edital = goldSet.editais[0]!;
    const entrada: EntradaExtracaoDTO = {
      editalId: edital.id,
      texto: textoSintetico(edital.id),
      temTextoSelecionavel: true,
      anexos: [],
      paginas: 1,
    };
    const fixtureMap = new Map<string, unknown>([
      [chavePorConteudo(montarRequisicaoExtracao(entrada)), fixtureLlm(edital)],
    ]);
    const gateway = new AnthropicLlmGateway(new RecordReplayLlmClient(fixtureMap));
    const signal = new AbortController().signal;
    const e1 = await gateway.extrair(entrada, signal);
    const e2 = await gateway.extrair(entrada, signal);
    expect(e1.objeto.valor).toBe(e2.objeto.valor);
    expect(e1.objeto.confianca.valor).toBe(e2.objeto.confianca.valor);
    expect(e1.confiancaGlobal().valor).toBe(e2.confiancaGlobal().valor);
  });
});
