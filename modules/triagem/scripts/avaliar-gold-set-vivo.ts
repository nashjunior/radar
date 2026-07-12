/**
 * Eval AO VIVO do gold set — extração REAL (AnthropicSdkClient → AnthropicLlmGateway, camadas 1–6)
 * sobre editais reais rotulados, pontuando precisão/recall/alucinação contra um GABARITO de valores.
 * SEM mock de LLM (nada de RecordReplay). Complementa o replay sintético do
 * `precisao-recall-gold-set.eval.test.ts` (RAD-204): lá o LLM é sintetizado a partir dos rótulos;
 * aqui o modelo roda de verdade e o rótulo é o valor ESPERADO por campo.
 *
 * ⚠ GOLD SET DE BOOTSTRAP — os editais abaixo são prosa realista hand-authored (não PNCP real),
 * rotulados por valores inequívocos do texto. NÃO é o gold set autoritativo de ≥50 editais reais
 * rotulados por QA (P-18/P-84/P-85, ainda Aberto). Serve para: (a) exercitar o harness de eval ao
 * vivo (a seam do P-85), (b) dar um primeiro número real de precisão/recall com o modelo. Troque o
 * DATASET por editais reais do PNCP rotulados por Quésia (A16 §2) quando P-18 fechar.
 *
 * Métrica idêntica à do eval de replay (A16 §2.4 · docs/07 §6), por campo crítico, ao
 * LIMIAR_CONFIANCA_PADRAO de produção:
 *   surfaced      = CampoExtraido.exibivelComoFato(limiar)  (confiança ≥ limiar E citação ligada)
 *   total         = campos críticos PRESENTES no gabarito       (denominador do recall)
 *   tp            = surfaced E valor bate com o gabarito
 *   fp            = surfaced E valor NÃO bate (inclui valor inventado em campo ausente/sigiloso)
 *   recall        = tp / total   ·   precisao = tp / (tp+fp)   ·   aluc.num = fp em campo numérico
 *
 * Este arquivo É o composition root do eval: só ele importa `@anthropic-ai/sdk` (P-74). Fica fora de
 * `src/` (tsconfig include: ["src"]), então não entra no build.
 *
 * PRÉ-REQUISITOS: `ANTHROPIC_API_KEY` no ambiente e acesso de rede. Consome tokens reais (editais
 * pequenos → `claude-sonnet-5` por escolherModelo). O `.env` não é auto-carregado pelo tsx:
 *   set -a; source .env; set +a           # exporta a key
 * RODAR: pnpm --filter @radar/triagem avaliar:gold-set:vivo
 *        (ou: tsx --env-file=.env scripts/avaliar-gold-set-vivo.ts)
 */
import Anthropic from '@anthropic-ai/sdk';
import type { EntradaExtracaoDTO } from '../src/application/index.js';
import { LIMIAR_CONFIANCA_PADRAO } from '../src/application/index.js';
import type { ExtracaoEdital } from '../src/domain/index.js';
import type { CategoriaHabilitacao } from '../src/domain/index.js';
import { AnthropicLlmGateway, AnthropicSdkClient } from '../src/infra/index.js';
import type { MessagesClient } from '../src/infra/index.js';

// ─── gabarito ───────────────────────────────────────────────────────────────

interface Gabarito {
  /** objeto correto quando o texto extraído contém TODOS estes termos (normalizado) */
  objetoTermos: string[];
  /** valor esperado em reais; null = sigiloso/ausente → esperar que NADA seja surfaced */
  valorEstimado: number | null;
  /** data de abertura das propostas 'yyyy-mm-dd'; null = sem abertura (dispensa/inexigibilidade) */
  dataAberturaPropostas: string | null;
  /** por categoria, um termo distintivo por requisito esperado (recall parcial da lista) */
  habilitacao: Partial<Record<CategoriaHabilitacao, string[]>>;
}

interface EditalGabarito {
  id: string;
  modalidade: string;
  texto: string;
  paginas: number;
  gabarito: Gabarito;
}

/**
 * 5 editais realistas (reaproveitados do DATASET_EXEMPLO de gravar-fixtures-gold-set-via-cli.ts),
 * cobrindo pregão/concorrência/dispensa/inexigibilidade e o caso adversarial de valor SIGILOSO
 * (gs-002) e ausência de abertura de propostas (gs-003/gs-004). Gabarito por valores inequívocos.
 */
const DATASET: EditalGabarito[] = [
  {
    id: 'gs-real-001',
    modalidade: 'pregao_eletronico',
    paginas: 2,
    texto: [
      'PREGÃO ELETRÔNICO Nº 12/2026 — PREFEITURA MUNICIPAL DE EXEMPLO',
      '1. DO OBJETO: aquisição de 50 (cinquenta) notebooks para as escolas municipais.',
      '2. DO VALOR ESTIMADO: R$ 250.000,00 (duzentos e cinquenta mil reais).',
      '3. DA SESSÃO: a abertura das propostas ocorrerá em 15/03/2026 às 09h00.',
      '4. DA HABILITAÇÃO FISCAL: exige-se Certidão Negativa de Débitos (CND) federal válida.',
      '5. PENALIDADES: multa de 10% sobre o valor do contrato em caso de inexecução total.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['notebook'],
      valorEstimado: 250000,
      dataAberturaPropostas: '2026-03-15',
      habilitacao: { fiscal: ['cnd'] },
    },
  },
  {
    id: 'gs-real-002',
    modalidade: 'concorrencia',
    paginas: 3,
    texto: [
      'CONCORRÊNCIA Nº 03/2026 — GOVERNO DO ESTADO DE EXEMPLO',
      '1. OBJETO: contratação de empresa para execução de obras de reforma na Escola Estadual Central.',
      '2. VALOR ESTIMADO: SIGILOSO (art. 24 da Lei 14.133/2021).',
      '3. DATA DE ABERTURA: 20 de abril de 2026, às 14h, na sede da Secretaria de Obras.',
      '4. HABILITAÇÃO TÉCNICA: atestado de capacidade técnica em obras de reforma de edificações.',
      '5. HABILITAÇÃO ECONÔMICA: capital social mínimo de R$ 500.000,00 ou patrimônio líquido equivalente.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['reforma'],
      valorEstimado: null, // SIGILOSO — não pode inventar valor (guardrail alucinação)
      dataAberturaPropostas: '2026-04-20',
      habilitacao: { tecnica: ['atestado'], economica: ['capital'] },
    },
  },
  {
    id: 'gs-real-003',
    modalidade: 'dispensa',
    paginas: 1,
    texto: [
      'DISPENSA DE LICITAÇÃO Nº 05/2026 — AUTARQUIA FEDERAL DE EXEMPLO',
      '1. OBJETO: contratação de empresa de consultoria em tecnologia da informação.',
      '2. VALOR: R$ 40.000,00 (quarenta mil reais) — enquadrado no art. 75, II, Lei 14.133/2021.',
      '3. PRAZO: o serviço deverá ser entregue em 30 dias a partir da assinatura do contrato.',
      '4. HABILITAÇÃO JURÍDICA: certidão de registro no CNPJ e contrato social atualizado.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['consultoria'],
      valorEstimado: 40000,
      dataAberturaPropostas: null, // dispensa — sem abertura de propostas
      habilitacao: { juridica: ['cnpj'] },
    },
  },
  {
    id: 'gs-real-004',
    modalidade: 'inexigibilidade',
    paginas: 1,
    texto: [
      'INEXIGIBILIDADE Nº 02/2026 — MUNICÍPIO DE EXEMPLO',
      '1. OBJETO: contratação de palestrante especialista em governança pública para evento institucional.',
      '2. VALOR: R$ 15.000,00 (quinze mil reais).',
      '3. JUSTIFICATIVA: notória especialização do contratado (art. 74, III, "d", Lei 14.133/2021).',
      '4. PRAZO DA PRESTAÇÃO: 10 de maio de 2026.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['palestrante'],
      valorEstimado: 15000,
      dataAberturaPropostas: null, // inexigibilidade — o "10/05" é prazo de prestação, não abertura
      habilitacao: {},
    },
  },
  {
    id: 'gs-real-005',
    modalidade: 'pregao_eletronico',
    paginas: 4,
    texto: [
      'PREGÃO ELETRÔNICO Nº 88/2026 — AUTARQUIA MUNICIPAL DE SAÚDE',
      '1. OBJETO: aquisição de medicamentos (insulina, metformina e losartana) para a rede básica de saúde.',
      '2. VALOR ESTIMADO: R$ 1.200.000,00 (um milhão e duzentos mil reais).',
      '3. ABERTURA DAS PROPOSTAS: 02/06/2026 às 10h, via sistema Comprasnet.',
      '4. HABILITAÇÃO FISCAL: Certidão Negativa de Débitos Trabalhistas (CNDT) e CND federal.',
      '5. HABILITAÇÃO TÉCNICA: alvará de funcionamento da ANVISA e licença sanitária vigente.',
    ].join('\n'),
    gabarito: {
      objetoTermos: ['medicamento'],
      valorEstimado: 1200000,
      dataAberturaPropostas: '2026-06-02',
      habilitacao: { fiscal: ['cndt'], tecnica: ['anvisa'] },
    },
  },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

/** minúsculo, sem diacrítico — casa com a normalização do bindCitacao (camada 6). */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function dataISO(d: Date | null): string | null {
  if (d === null) return null;
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

const CATEGORIAS: readonly CategoriaHabilitacao[] = ['juridica', 'fiscal', 'tecnica', 'economica'];

// ─── métricas (mesma semântica do eval de replay) ──────────────────────────────

interface Metricas {
  campo: string;
  total: number;
  tp: number;
  fp: number;
  fn: number;
  alucinacoesNumericas: number;
  recall: number;
  precisao: number;
}

type CampoEscalar = 'objeto' | 'valorEstimado' | 'dataAberturaPropostas';

interface CasoEscalar {
  surfaced: boolean;
  rotuloPresente: boolean;
  extraidoCorreto: boolean;
  numerico: boolean;
}

/** Avalia um campo escalar de uma extração contra o gabarito, ao limiar de produção. */
function avaliarEscalar(
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

function metricasEscalar(casos: CasoEscalar[], nome: string): Metricas {
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
function metricasHabilitacao(resultados: { edital: EditalGabarito; extracao: ExtracaoEdital }[]): Metricas {
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

function metricasGlobal(por: Metricas[]): Metricas {
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

// ─── relatório ──────────────────────────────────────────────────────────────

const GATE_RECALL = 0.95;
const GATE_PRECISAO = 0.9;
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const marca = (ok: boolean): string => (ok ? '✓' : '✗');

function linhaEdital(edital: EditalGabarito, extracao: ExtracaoEdital): string {
  const g = edital.gabarito;
  const obj = avaliarEscalar(extracao, 'objeto', g, LIMIAR_CONFIANCA_PADRAO);
  const val = avaliarEscalar(extracao, 'valorEstimado', g, LIMIAR_CONFIANCA_PADRAO);
  const dat = avaliarEscalar(extracao, 'dataAberturaPropostas', g, LIMIAR_CONFIANCA_PADRAO);
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

function imprimirTabela(por: Metricas[], global: Metricas): void {
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

// ─── runner ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'ANTHROPIC_API_KEY ausente. Exporte antes de rodar:\n  set -a; source .env; set +a\n' +
        '(ou rode com: tsx --env-file=.env scripts/avaliar-gold-set-vivo.ts)',
    );
    process.exitCode = 1;
    return;
  }

  const anthropic = new Anthropic();
  const gateway = new AnthropicLlmGateway(
    new AnthropicSdkClient(anthropic.messages as unknown as MessagesClient),
  );
  const signal = new AbortController().signal;

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║  EVAL AO VIVO — Gold Set de BOOTSTRAP (extração REAL, sem mock de LLM)      ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝');
  console.log(`Editais: ${DATASET.length}  |  LIMIAR = ${LIMIAR_CONFIANCA_PADRAO}  |  modelo por escolherModelo (editais pequenos → sonnet-5)`);
  console.log('⚠ Bootstrap hand-authored — NÃO é o gold set real de ≥50 editais (P-18/P-84/P-85).\n');

  const resultados: { edital: EditalGabarito; extracao: ExtracaoEdital }[] = [];
  for (const edital of DATASET) {
    const entrada: EntradaExtracaoDTO = {
      editalId: edital.id,
      texto: edital.texto,
      temTextoSelecionavel: true,
      anexos: [],
      paginas: edital.paginas,
    };
    process.stdout.write(`→ extraindo ${edital.id}… `);
    try {
      const { extracao } = await gateway.extrair(entrada, signal);
      resultados.push({ edital, extracao });
      console.log('ok');
    } catch (err) {
      console.log(`FALHOU — ${String(err)}`);
    }
  }

  if (resultados.length === 0) {
    console.error('\nNenhuma extração — abortando.');
    process.exitCode = 1;
    return;
  }

  console.log('\n── por edital ──');
  for (const { edital, extracao } of resultados) console.log(linhaEdital(edital, extracao));

  const mObjeto = metricasEscalar(
    resultados.map(({ extracao, edital }) => avaliarEscalar(extracao, 'objeto', edital.gabarito, LIMIAR_CONFIANCA_PADRAO)),
    'objeto',
  );
  const mValor = metricasEscalar(
    resultados.map(({ extracao, edital }) => avaliarEscalar(extracao, 'valorEstimado', edital.gabarito, LIMIAR_CONFIANCA_PADRAO)),
    'valorEstimado',
  );
  const mData = metricasEscalar(
    resultados.map(({ extracao, edital }) => avaliarEscalar(extracao, 'dataAberturaPropostas', edital.gabarito, LIMIAR_CONFIANCA_PADRAO)),
    'dataAberturaPropostas',
  );
  const mHab = metricasHabilitacao(resultados);
  const global = metricasGlobal([mObjeto, mValor, mData, mHab]);

  imprimirTabela([mObjeto, mValor, mData, mHab], global);

  const recallOk = global.recall >= GATE_RECALL;
  const precisaoOk = global.precisao >= GATE_PRECISAO;
  const alucOk = global.alucinacoesNumericas === 0;
  console.log(`Gate recall ≥ ${pct(GATE_RECALL)} [docs/07 §6]: ${pct(global.recall)} ${marca(recallOk)}`);
  console.log(`Gate precisão ≥ ${pct(GATE_PRECISAO)}          : ${pct(global.precisao)} ${marca(precisaoOk)}`);
  console.log(`Gate alucinação numérica = 0     : ${global.alucinacoesNumericas} ${marca(alucOk)}`);
  console.log('');

  if (resultados.length < DATASET.length) {
    console.warn(`⚠ ${DATASET.length - resultados.length} edital(is) falharam na extração.`);
  }
  if (!recallOk || !precisaoOk || !alucOk) process.exitCode = 1;
}

main().catch((err) => {
  console.error('eval ao vivo falhou:', err);
  process.exitCode = 1;
});
