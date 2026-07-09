/**
 * Testes unitários do harness de calibração (P-19 · A16 §2.4).
 *
 * Cobre:
 *   — Eixo 1 (regras de negócio): invariantes do algoritmo de varredura e critérios
 *     de seleção do limiar ótimo sob condições adversariais.
 *   — Eixo 2 (stress): comportamento nos limites do domínio (todos corretos, todos errados,
 *     confiança exata no limiar, campo numérico com alucinação justo na fronteira).
 *
 * Importa as funções canônicas de calibração de src/application/calibracao-limiar.ts.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calibrar, varreLimiar } from '../../application/calibracao-limiar.js';
import type { EditalRotulado, GoldSet } from '../../application/calibracao-limiar.js';

// ─── helpers ─────────────────────────────────────────────────────────────────

function campoCorreto(confianca: number, numerico = false): EditalRotulado['campos']['objeto'] {
  return { rotuloPresente: true, extraidoCorreto: true, confianca, critico: true, numerico };
}

function campoErrado(confianca: number, numerico = false): EditalRotulado['campos']['objeto'] {
  return { rotuloPresente: true, extraidoCorreto: false, confianca, critico: true, numerico };
}

function campoAusente(numerico = false): EditalRotulado['campos']['objeto'] {
  return { rotuloPresente: false, extraidoCorreto: false, confianca: 0, critico: true, numerico };
}

function edital(
  id: string,
  objConf: number,
  valConf: number | null,
  dataConf: number,
  objCorreto = true,
  valCorreto = true,
  dataCorreto = true,
): EditalRotulado {
  return {
    id,
    modalidade: 'PregaoEletronico',
    campos: {
      objeto: objCorreto ? campoCorreto(objConf) : campoErrado(objConf),
      valorEstimado:
        valConf === null ? campoAusente(true) : valCorreto ? campoCorreto(valConf, true) : campoErrado(valConf, true),
      dataAberturaPropostas: dataCorreto ? campoCorreto(dataConf, true) : campoErrado(dataConf, true),
    },
  };
}

// ─── testes ──────────────────────────────────────────────────────────────────

describe('varreLimiar — mecânica da varredura', () => {
  it('produz 51 pontos (0,50 a 1,00 em passo 0,01)', () => {
    const pontos = varreLimiar([edital('e1', 0.9, 0.9, 0.9)]);
    expect(pontos).toHaveLength(51);
    expect(pontos[0]!.limiar).toBe(0.5);
    expect(pontos[50]!.limiar).toBe(1.0);
  });

  it('recall = 1 quando todos os campos corretos estão acima do limiar', () => {
    const editais = [edital('e1', 0.9, 0.9, 0.9), edital('e2', 0.8, 0.8, 0.8)];
    const ponto70 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.recall).toBe(1);
    expect(ponto70.hits).toBe(6); // 3 campos × 2 editais
    expect(ponto70.total).toBe(6);
  });

  it('recall = 0 quando todos estão abaixo do limiar', () => {
    const editais = [edital('e1', 0.5, 0.5, 0.5)];
    const ponto80 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 80)!;
    expect(ponto80.recall).toBe(0);
    expect(ponto80.hits).toBe(0);
  });

  it('campos ausentes (rotuloPresente=false) não entram no total', () => {
    const editais = [edital('e1', 0.9, null, 0.9)]; // valorEstimado ausente
    const pontos = varreLimiar(editais);
    expect(pontos[0]!.total).toBe(2); // só objeto + data
  });

  it('campo correto no exato limiar (conf = limiar) conta como hit', () => {
    const editais = [edital('e1', 0.70, 0.70, 0.70)];
    const ponto70 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.hits).toBe(3);
  });

  it('campo correto abaixo do limiar (conf = limiar - 0,01) NÃO conta como hit', () => {
    const editais = [edital('e1', 0.69, 0.69, 0.69)];
    const ponto70 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.hits).toBe(0);
    expect(ponto70.total).toBe(3);
  });

  it('alucinação numérica: campo errado acima do limiar incrementa alucinacoesNumericas', () => {
    const editais = [edital('e1', 0.9, 0.9, 0.9, true, false, false)]; // val e data errados
    const ponto80 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 80)!;
    expect(ponto80.alucinacoesNumericas).toBe(2); // valorEstimado + data (ambos numéricos)
  });

  it('campo textual errado NÃO conta como alucinação numérica', () => {
    const editais = [edital('e1', 0.9, 0.9, 0.9, false, true, true)]; // objeto errado (textual)
    const ponto80 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 80)!;
    expect(ponto80.alucinacoesNumericas).toBe(0);
  });
});

describe('calibrar — seleção do limiar ótimo', () => {
  it('escolhe o MAIOR limiar com recall ≥ 95% E zero alucinação', () => {
    // 20 editais corretos com conf entre 0,70 e 0,99 — maior limiar aceitável: 0,70
    const editais: EditalRotulado[] = Array.from({ length: 20 }, (_, i) => {
      const conf = 0.70 + (i / 20) * 0.29; // 0.70..0.985
      return edital(`e${i}`, conf, conf, conf);
    });
    const res = calibrar(editais);
    expect(res.metaRecallAtingida).toBe(true);
    expect(res.zeroAlucinacaoNumerica).toBe(true);
    expect(res.limiarOtimo).toBeGreaterThanOrEqual(0.70);
  });

  it('confirma 0,70 com o gold set sintético de referência (P-19)', () => {
    const caminho = resolve(__dirname, '../../../scripts/fixtures/gold-set-rotulado-sintetico.json');
    const gs: GoldSet = JSON.parse(readFileSync(caminho, 'utf8'));
    const res = calibrar(gs.editais);

    expect(res.limiarOtimo).toBe(0.70);
    expect(res.metaRecallAtingida).toBe(true);
    expect(res.recallNoLimiar).toBeGreaterThanOrEqual(0.95);
    expect(res.zeroAlucinacaoNumerica).toBe(true);
    expect(res.alucinacoesNoLimiar).toBe(0);
  });

  it('recall@0,71 < 95% no gold set sintético — confirma que 0,70 é o teto', () => {
    const caminho = resolve(__dirname, '../../../scripts/fixtures/gold-set-rotulado-sintetico.json');
    const gs: GoldSet = JSON.parse(readFileSync(caminho, 'utf8'));
    const curva = varreLimiar(gs.editais);
    const ponto71 = curva.find((p) => Math.round(p.limiar * 100) === 71)!;
    expect(ponto71.recall).toBeLessThan(0.95);
  });

  it('zero alucinação numérica garantida em 0,70 (todos erros numéricos abaixo do limiar)', () => {
    const caminho = resolve(__dirname, '../../../scripts/fixtures/gold-set-rotulado-sintetico.json');
    const gs: GoldSet = JSON.parse(readFileSync(caminho, 'utf8'));
    const curva = varreLimiar(gs.editais);
    const ponto70 = curva.find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.alucinacoesNumericas).toBe(0);
  });

  it('sem editais: limiar ótimo retorna 0,50 (mais permissivo) sem crash', () => {
    const res = calibrar([]);
    expect(res.limiarOtimo).toBe(0.50);
    expect(res.totalCamposCriticos).toBe(0);
  });

  it('todos errados: metaRecallAtingida = false', () => {
    const editais = Array.from({ length: 10 }, (_, i) =>
      edital(`e${i}`, 0.9, 0.9, 0.9, false, false, false),
    );
    const res = calibrar(editais);
    expect(res.metaRecallAtingida).toBe(false);
  });
});

describe('calibrar — stress: limites de domínio dos VOs', () => {
  it('confiança = 0 no campo crítico → esse campo nunca é hit em qualquer limiar ≥ 0,50', () => {
    const editais = [edital('e1', 0.0, 0.9, 0.9)];
    const curva = varreLimiar(editais);
    for (const p of curva) {
      const objetoHit = p.hits < p.total; // objeto com conf=0 nunca passa
      expect(objetoHit || p.recall < 1).toBe(true);
    }
  });

  it('confiança = 1 (máxima) → campo é hit em todos os limiares ≤ 1,00', () => {
    const editais = [edital('e1', 1.0, 1.0, 1.0)];
    const curva = varreLimiar(editais);
    for (const p of curva) {
      expect(p.hits).toBe(3); // sempre 3 hits em qualquer limiar ≤ 1.0
    }
  });

  it('campo numérico incorreto com conf = 0,70 (exatamente no limiar) → alucinação detectada', () => {
    const editais = [edital('e1', 0.9, 0.70, 0.9, true, false, true)];
    const ponto70 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.alucinacoesNumericas).toBe(1);
  });

  it('campo numérico incorreto com conf = 0,69 (abaixo do limiar 0,70) → filtrado, zero alucinação', () => {
    const editais = [edital('e1', 0.9, 0.69, 0.9, true, false, true)];
    const ponto70 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.alucinacoesNumericas).toBe(0);
  });

  it('precisão = 1 quando todos os extraídos acima do limiar são corretos', () => {
    const editais = [edital('e1', 0.9, 0.9, 0.9)];
    const ponto70 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.precisao).toBe(1);
  });

  it('precisão = 0 quando todos os extraídos acima do limiar estão errados', () => {
    const editais = [edital('e1', 0.9, 0.9, 0.9, false, false, false)];
    const ponto70 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 70)!;
    expect(ponto70.precisao).toBe(0);
  });

  it('precisão = 1 quando nada é extraído acima do limiar (divisão por zero segura)', () => {
    const editais = [edital('e1', 0.5, 0.5, 0.5)];
    const ponto90 = varreLimiar(editais).find((p) => Math.round(p.limiar * 100) === 90)!;
    expect(ponto90.precisao).toBe(1); // extraidos = 0 → precisao = 1 (nenhum falso positivo)
  });
});
