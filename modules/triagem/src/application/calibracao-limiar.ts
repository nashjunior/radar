/**
 * Funções puras de calibração do limiar de confiança (P-19 · A16 §2.4).
 *
 * Protocolo (docs/10 §4.1 / A16 §2.4):
 *   varrer o limiar no gold set rotulado e escolher o MAIOR limiar que ainda garante
 *   recall ≥ metaRecall nos campos críticos (= "menor corte suficiente"), verificando
 *   também zero alucinação em campos numéricos críticos.
 *
 * Importado pelo CLI (`scripts/calibrar-limiar-gold-set.ts`) e pelos testes unitários.
 */

export interface CampoRotulado {
  /** true quando o gold label tem valor não-null (campo presente no edital) */
  rotuloPresente: boolean;
  /** true quando a extração do LLM coincide com o rótulo (dentro da tolerância) */
  extraidoCorreto: boolean;
  /** score de confiança [0,1] retornado pelo LLM para este campo */
  confianca: number;
  /** reflete `is_critico` do esquema de rótulo (docs/10 §5.2 / A16 §2.2) */
  critico: boolean;
  /** true para valorEstimado, datas — guardrail "zero alucinação numérica" (docs/10 §5) */
  numerico: boolean;
}

/**
 * `habilitação` não é escalar (docs/10 §5.2): cada categoria é uma LISTA de N requisitos
 * exigidos pelo edital. Cada requisito rotulado vira seu próprio `CampoRotulado` — mesma forma
 * usada pelos campos escalares — para que varreLimiar()/calibrar() somem hits/total requisito a
 * requisito, expressando recall PARCIAL sobre a lista (ex.: 7 de 9 corretos) sem precisar de
 * agregação especial. `rotuloPresente` é sempre `true` aqui: um requisito só entra no array
 * quando algum anotador consegue ancorá-lo no texto-fonte (docs/10 §5.4 regra 4); o que nenhum
 * anotador ancora simplesmente não vira item da lista, já excluído do denominador do recall.
 */
export interface CamposHabilitacao {
  juridica: CampoRotulado[];
  fiscal: CampoRotulado[];
  tecnica: CampoRotulado[];
  economica: CampoRotulado[];
}

export interface EditalRotulado {
  id: string;
  modalidade: string;
  formato?: 'nativo' | 'imagem' | 'misto';
  adversarial?: boolean;
  campos: {
    objeto: CampoRotulado;
    valorEstimado: CampoRotulado;
    dataAberturaPropostas: CampoRotulado;
    /** Data da sessão pública — is_critico: sim em docs/10 §5.2, distinto do prazo de envio de propostas */
    dataSessao: CampoRotulado;
    habilitacao: CamposHabilitacao;
  };
}

export interface GoldSet {
  meta: {
    versao: string;
    protocolo: string;
    tipo: 'sintetico' | 'real';
    totalEditais: number;
    geradoEm: string;
  };
  editais: EditalRotulado[];
}

export interface PontoLimiar {
  limiar: number;
  hits: number;          // corretos E conf ≥ limiar
  extraidos: number;     // conf ≥ limiar (corretos + errados)
  total: number;         // campos críticos presentes no gold set
  recall: number;        // hits / total
  precisao: number;      // hits / extraidos (1 quando extraidos = 0)
  alucinacoesNumericas: number; // incorretos numéricos com conf ≥ limiar
}

export interface ResultadoCalibracao {
  limiarOtimo: number;
  recallNoLimiar: number;
  precisaoNoLimiar: number;
  alucinacoesNoLimiar: number;
  metaRecallAtingida: boolean;
  zeroAlucinacaoNumerica: boolean;
  totalCamposCriticos: number;
  totalEditais: number;
  curva: PontoLimiar[];
}

/**
 * Achata todos os campos atômicos de um edital rotulado para fins de recall: os escalares
 * (objeto, valorEstimado, ...) e cada requisito de cada categoria de habilitação, um a um —
 * é o que faz varreLimiar() somar recall PARCIAL sobre a lista de habilitação junto com o
 * recall dos campos escalares, sem tratamento especial.
 */
function camposAtomicos(edital: EditalRotulado): CampoRotulado[] {
  const { habilitacao, ...escalares } = edital.campos;
  return [
    ...Object.values(escalares),
    ...habilitacao.juridica,
    ...habilitacao.fiscal,
    ...habilitacao.tecnica,
    ...habilitacao.economica,
  ];
}

/**
 * Varre limiares de 0,50 a 1,00 (passo = 0,01) e calcula métricas por ponto.
 * Usa aritmética inteira para evitar erro de ponto flutuante.
 */
export function varreLimiar(editais: EditalRotulado[]): PontoLimiar[] {
  const pontos: PontoLimiar[] = [];

  for (let t100 = 50; t100 <= 100; t100++) {
    const limiar = t100 / 100;
    let hits = 0;
    let extraidos = 0;
    let total = 0;
    let alucinacoesNumericas = 0;

    for (const edital of editais) {
      for (const campo of camposAtomicos(edital)) {
        if (!campo.critico || !campo.rotuloPresente) continue;
        total++;
        if (campo.confianca >= limiar) {
          extraidos++;
          if (campo.extraidoCorreto) {
            hits++;
          } else if (campo.numerico) {
            alucinacoesNumericas++;
          }
        }
      }
    }

    pontos.push({
      limiar,
      hits,
      extraidos,
      total,
      recall: total > 0 ? hits / total : 0,
      precisao: extraidos > 0 ? hits / extraidos : 1,
      alucinacoesNumericas,
    });
  }

  return pontos;
}

/**
 * Encontra o MAIOR limiar (corte mais estrito) com recall ≥ metaRecall E
 * zero alucinação numérica — o "menor corte suficiente" do protocolo A16 §2.4.
 */
export function calibrar(editais: EditalRotulado[], metaRecall = 0.95): ResultadoCalibracao {
  const curva = varreLimiar(editais);

  // Maior limiar que ainda satisfaz ambas as condições
  let otimo: PontoLimiar | undefined;
  for (const ponto of curva) {
    if (ponto.recall >= metaRecall && ponto.alucinacoesNumericas === 0) {
      otimo = ponto;
    }
  }

  if (!otimo) {
    // Nenhum limiar satisfaz as restrições — fallback no mais permissivo
    otimo = curva[0]!;
  }

  return {
    limiarOtimo: otimo.limiar,
    recallNoLimiar: otimo.recall,
    precisaoNoLimiar: otimo.precisao,
    alucinacoesNoLimiar: otimo.alucinacoesNumericas,
    metaRecallAtingida: otimo.recall >= metaRecall,
    zeroAlucinacaoNumerica: otimo.alucinacoesNumericas === 0,
    totalCamposCriticos: otimo.total,
    totalEditais: editais.length,
    curva,
  };
}
