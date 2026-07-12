/**
 * Métricas do eval ao vivo do gold set (precisão/recall/alucinação por campo crítico, ao
 * `LIMIAR_CONFIANCA_PADRAO` de produção — A16 §2.4 · docs/07 §6). Extraído de
 * `avaliar-gold-set-vivo.ts` (RAD-282) para ser reusado também pelo comparativo raso-vs-completo.
 *
 *   surfaced      = CampoExtraido.exibivelComoFato(limiar)  (confiança ≥ limiar E citação ligada)
 *   total         = campos críticos PRESENTES no gabarito       (denominador do recall)
 *   tp            = surfaced E valor bate com o gabarito
 *   fp            = surfaced E valor NÃO bate (inclui valor inventado em campo ausente/sigiloso)
 *   recall        = tp / total   ·   precisao = tp / (tp+fp)   ·   aluc.num = fp em campo numérico
 */
import type { CategoriaHabilitacao } from '../../src/domain/index.js';
import type { ExtracaoEdital } from '../../src/domain/index.js';
import type { EditalGabarito, Gabarito } from './dataset.js';

export type CampoEscalar = 'objeto' | 'valorEstimado' | 'dataAberturaPropostas';

export interface CasoEscalar {
  surfaced: boolean;
  rotuloPresente: boolean;
  extraidoCorreto: boolean;
  numerico: boolean;
}

export interface Metricas {
  campo: string;
  total: number;
  tp: number;
  fp: number;
  fn: number;
  alucinacoesNumericas: number;
  recall: number;
  precisao: number;
}

export const CATEGORIAS: readonly CategoriaHabilitacao[] = ['juridica', 'fiscal', 'tecnica', 'economica'];

/** minúsculo, sem diacrítico — casa com a normalização do bindCitacao (camada 6). */
export function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function dataISO(d: Date | null): string | null {
  if (d === null) return null;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** Avalia um campo escalar de uma extração contra o gabarito, ao limiar de produção. */
export function avaliarEscalar(
  extracao: ExtracaoEdital,
  campo: CampoEscalar,
  gab: Gabarito,
  limiar: number,
): CasoEscalar {
  if (campo === 'objeto') {
    const surfaced = extracao.objeto.exibivelComoFato(limiar);
    const v = norm(extracao.objeto.valor);
    const extraidoCorreto = gab.objetoTermos.every((t) => v.includes(norm(t)));
    return { surfaced, rotuloPresente: true, extraidoCorreto, numerico: false };
  }
  if (campo === 'valorEstimado') {
    const surfaced = extracao.valorEstimado.exibivelComoFato(limiar);
    const extraidoCorreto = extracao.valorEstimado.valor === gab.valorEstimado;
    return { surfaced, rotuloPresente: gab.valorEstimado !== null, extraidoCorreto, numerico: true };
  }
  const surfaced = extracao.dataAberturaPropostas.exibivelComoFato(limiar);
  const extraidoCorreto = dataISO(extracao.dataAberturaPropostas.valor) === gab.dataAberturaPropostas;
  return {
    surfaced,
    rotuloPresente: gab.dataAberturaPropostas !== null,
    extraidoCorreto,
    numerico: true,
  };
}

export function metricasEscalar(casos: CasoEscalar[], nome: string): Metricas {
  let total = 0, tp = 0, fp = 0, alucinacoesNumericas = 0;
  for (const c of casos) {
    if (c.rotuloPresente) {
      total++;
      if (c.surfaced && c.extraidoCorreto) tp++;
    }
    if (c.surfaced && !c.extraidoCorreto) {
      fp++;
      if (c.numerico) alucinacoesNumericas++;
    }
  }
  const fn = total - tp;
  return {
    campo: nome,
    total,
    tp,
    fp,
    fn,
    alucinacoesNumericas,
    recall: total > 0 ? tp / total : 0,
    precisao: tp + fp > 0 ? tp / (tp + fp) : 1,
  };
}

/**
 * Habilitação: recall PARCIAL sobre a lista de requisitos esperados. Sem confiança por-requisito no
 * agregado extraído → "surfaced" = o requisito existe na saída (matched). FP não é pontuado (o
 * gabarito de bootstrap não enumera exaustivamente todos os requisitos legítimos); requisitos extra
 * são listados no log para inspeção, não punem a precisão.
 */
export function metricasHabilitacao(resultados: { edital: EditalGabarito; extracao: ExtracaoEdital }[]): Metricas {
  let total = 0, tp = 0;
  for (const { edital, extracao } of resultados) {
    for (const cat of CATEGORIAS) {
      for (const termo of edital.gabarito.habilitacao[cat] ?? []) {
        total++;
        const matched = extracao.requisitos.some(
          (r) => r.categoria === cat && norm(r.descricao).includes(norm(termo)),
        );
        if (matched) tp++;
      }
    }
  }
  return {
    campo: 'habilitacao',
    total,
    tp,
    fp: 0,
    fn: total - tp,
    alucinacoesNumericas: 0,
    recall: total > 0 ? tp / total : 0,
    precisao: 1,
  };
}

export function metricasGlobal(por: Metricas[]): Metricas {
  const soma = (k: keyof Metricas): number => por.reduce((s, m) => s + (m[k] as number), 0);
  const total = soma('total'), tp = soma('tp'), fp = soma('fp');
  return {
    campo: 'GLOBAL',
    total,
    tp,
    fp,
    fn: soma('fn'),
    alucinacoesNumericas: soma('alucinacoesNumericas'),
    recall: total > 0 ? tp / total : 0,
    precisao: tp + fp > 0 ? tp / (tp + fp) : 1,
  };
}

export const GATE_RECALL = 0.95;
export const GATE_PRECISAO = 0.9;
export const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
export const marca = (ok: boolean): string => (ok ? '✓' : '✗');

export function linhaEdital(edital: EditalGabarito, extracao: ExtracaoEdital, limiar: number): string {
  const g = edital.gabarito;
  const obj = avaliarEscalar(extracao, 'objeto', g, limiar);
  const val = avaliarEscalar(extracao, 'valorEstimado', g, limiar);
  const dat = avaliarEscalar(extracao, 'dataAberturaPropostas', g, limiar);
  const habAlvo = CATEGORIAS.flatMap((c) => (g.habilitacao[c] ?? []).map((t) => ({ c, t })));
  const habOk = habAlvo.filter(({ c, t }) =>
    extracao.requisitos.some((r) => r.categoria === c && norm(r.descricao).includes(norm(t))),
  ).length;
  const valTxt =
    g.valorEstimado === null
      ? `sigiloso→${extracao.valorEstimado.valor === null ? 'null ✓' : `${extracao.valorEstimado.valor} ✗ ALUC`}`
      : `${marca(val.surfaced && val.extraidoCorreto)} (${extracao.valorEstimado.valor})`;
  const datTxt =
    g.dataAberturaPropostas === null
      ? `ausente→${dataISO(extracao.dataAberturaPropostas.valor) === null ? 'null ✓' : `${dataISO(extracao.dataAberturaPropostas.valor)} ✗`}`
      : `${marca(dat.surfaced && dat.extraidoCorreto)} (${dataISO(extracao.dataAberturaPropostas.valor)})`;
  return [
    `  ${edital.id} [${edital.modalidade}]`,
    `    objeto: ${marca(obj.surfaced && obj.extraidoCorreto)} conf=${extracao.objeto.confianca.valor.toFixed(2)} "${extracao.objeto.valor.slice(0, 48)}"`,
    `    valor:  ${valTxt}  conf=${extracao.valorEstimado.confianca.valor.toFixed(2)}`,
    `    data:   ${datTxt}  conf=${extracao.dataAberturaPropostas.confianca.valor.toFixed(2)}`,
    `    hab:    ${habOk}/${habAlvo.length} requisitos  (extraídos: ${extracao.requisitos.length})`,
  ].join('\n');
}

export function imprimirTabela(por: Metricas[], global: Metricas): void {
  const sep = '─'.repeat(78);
  const cols = ['campo'.padEnd(22), 'total', '  TP', '  FP', '  FN', 'recall ', 'precisao', 'aluc.num'];
  console.log('\n' + sep);
  console.log(cols.join('  '));
  console.log(sep);
  for (const m of [...por, global]) {
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
}

/** Roda as 4 métricas (objeto/valor/data/habilitação) + GLOBAL para um conjunto de resultados. */
export function calcularMetricas(
  resultados: { edital: EditalGabarito; extracao: ExtracaoEdital }[],
  limiar: number,
): { por: Metricas[]; global: Metricas } {
  const mObjeto = metricasEscalar(
    resultados.map(({ extracao, edital }) => avaliarEscalar(extracao, 'objeto', edital.gabarito, limiar)),
    'objeto',
  );
  const mValor = metricasEscalar(
    resultados.map(({ extracao, edital }) => avaliarEscalar(extracao, 'valorEstimado', edital.gabarito, limiar)),
    'valorEstimado',
  );
  const mData = metricasEscalar(
    resultados.map(({ extracao, edital }) => avaliarEscalar(extracao, 'dataAberturaPropostas', edital.gabarito, limiar)),
    'dataAberturaPropostas',
  );
  const mHab = metricasHabilitacao(resultados);
  const por = [mObjeto, mValor, mData, mHab];
  return { por, global: metricasGlobal(por) };
}

/** Média de `confiancaGlobal()` (mínimo entre objeto/valor/data — RAD-282) sobre os resultados. */
export function confiancaGlobalMedia(resultados: { extracao: ExtracaoEdital }[]): number {
  if (resultados.length === 0) return 0;
  const soma = resultados.reduce((s, { extracao }) => s + extracao.confiancaGlobal().valor, 0);
  return soma / resultados.length;
}

/** Fração de campos escalares (objeto/valor/data × edital) exibidos como fato, ao limiar dado. */
export function fracaoExibivelComoFato(
  resultados: { extracao: ExtracaoEdital }[],
  limiar: number,
): { exibiveis: number; total: number } {
  const campos: CampoEscalar[] = ['objeto', 'valorEstimado', 'dataAberturaPropostas'];
  let exibiveis = 0;
  const total = resultados.length * campos.length;
  for (const { extracao } of resultados) {
    for (const campo of campos) {
      if (extracao[campo].exibivelComoFato(limiar)) exibiveis++;
    }
  }
  return { exibiveis, total };
}
