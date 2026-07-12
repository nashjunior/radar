/**
 * Comparativo Sonnet-vs-Opus do gold set (P-93, tiers de modelo) — RAD-337. Mesmo DATASET, mesmo
 * prompt/schema (`montarRequisicaoExtracao`), variando só o `modelo` da requisição (sobrepondo
 * `escolherModelo`, igual ao `MODELO_FORCADO` de `tools/pipeline-local/src/rodar.ts`). Mede recall/
 * precisão/alucinação por campo (não só "valores idênticos" como o experimento manual N=3) +
 * distribuição de confiança + custo real (ledger de tokens), para decidir se `escolherModelo()`
 * deveria ser Sonnet-first-com-escalada em vez do corte cru >60k chars→Opus.
 *
 * ⚠ Roda sobre o gold set de BOOTSTRAP (5 editais hand-authored, P-18 ainda Aberto) — não é uma
 * validação estatisticamente decisiva em escala (isso requer o gold set real de ≥50, bloqueado em
 * P-18/P-85). Serve para estender o N=3 informal com métricas formais, não para substituir o gate.
 *
 * PRÉ-REQUISITOS: ANTHROPIC_API_KEY (ver avaliar-gold-set-vivo.ts). Roda o dataset 2×, consome
 * tokens reais nas duas passadas. Par default = tiers atuais do router síncrono (`escolherModelo`);
 * sobreponha via env para validar outro par (ex.: o par BATCH-capable real do Bedrock, P-93/RAD-231
 * — Sonnet 5/Opus 4.8 NÃO estão nessa matriz):
 *   MODELO_A=claude-sonnet-4-6 MODELO_B=claude-opus-4-6 pnpm --filter @radar/triagem avaliar:gold-set:vivo:modelo
 * RODAR: pnpm --filter @radar/triagem avaliar:gold-set:vivo:modelo
 */
import Anthropic from '@anthropic-ai/sdk';
import { LIMIAR_CONFIANCA_PADRAO } from '../src/application/index.js';
import { calcularCustoUsd } from '../src/application/index.js';
import type { UsoLlm } from '../src/application/index.js';
import type { ExtracaoEdital } from '../src/domain/index.js';
import {
  AnthropicSdkClient,
  interpretarSaidaExtracao,
  montarRequisicaoExtracao,
} from '../src/infra/index.js';
import type { MessagesClient } from '../src/infra/index.js';
import { DATASET, type EditalGabarito } from './gold-set/dataset.js';
import {
  calcularMetricas,
  confiancaGlobalMedia,
  imprimirTabela,
  linhaEdital,
  pct,
  type Metricas,
} from './gold-set/metricas.js';

const MODELO_A = process.env.MODELO_A ?? 'claude-sonnet-5';
const MODELO_B = process.env.MODELO_B ?? 'claude-opus-4-8';

interface Resultado {
  edital: EditalGabarito;
  extracao: ExtracaoEdital;
  uso: UsoLlm;
}

async function extrairComModelo(
  client: AnthropicSdkClient,
  modelo: string,
  signal: AbortSignal,
): Promise<Resultado[]> {
  const resultados: Resultado[] = [];
  for (const edital of DATASET) {
    const entrada = {
      editalId: edital.id,
      texto: edital.texto,
      temTextoSelecionavel: true,
      anexos: [],
      paginas: edital.paginas,
    };
    process.stdout.write(`  → [${modelo}] ${edital.id}… `);
    try {
      const req = { ...montarRequisicaoExtracao(entrada), modelo };
      const { input, uso } = await client.extrairViaFerramenta(req, signal);
      const extracao = interpretarSaidaExtracao(input, entrada);
      resultados.push({ edital, extracao, uso });
      console.log(`ok (in=${uso.inputTokens} out=${uso.outputTokens})`);
    } catch (err) {
      console.log(`FALHOU — ${String(err)}`);
    }
  }
  return resultados;
}

function custoTotalUsd(resultados: Resultado[]): number {
  return resultados.reduce((soma, r) => soma + calcularCustoUsd(r.uso), 0);
}

function linhaDelta(rotulo: string, a: number, b: number): string {
  const delta = a - b;
  const sinal = delta >= 0 ? '+' : '';
  return `  ${rotulo.padEnd(40)} ${MODELO_A} ${pct(a).padStart(7)}  vs  ${MODELO_B} ${pct(b).padStart(7)}   (${sinal}${pct(delta)})`;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY ausente. Exporte antes de rodar:\n  set -a; source .env.local; set +a');
    process.exitCode = 1;
    return;
  }

  const anthropic = new Anthropic();
  const client = new AnthropicSdkClient(anthropic.messages as unknown as MessagesClient);
  const signal = new AbortController().signal;

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log(`║  COMPARATIVO — ${MODELO_A} vs. ${MODELO_B} (P-93, RAD-337)`.padEnd(79) + '║');
  console.log('║  Mesmo gold set de bootstrap (P-18), mesmo prompt/schema, modelo forçado   ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log(`▸ ${MODELO_A}`);
  const resultadosSonnet = await extrairComModelo(client, MODELO_A, signal);

  console.log(`\n▸ ${MODELO_B}`);
  const resultadosOpus = await extrairComModelo(client, MODELO_B, signal);

  if (resultadosSonnet.length === 0 || resultadosOpus.length === 0) {
    console.error('\nUm dos modelos não produziu nenhuma extração — abortando o comparativo.');
    process.exitCode = 1;
    return;
  }

  console.log(`\n── ${MODELO_A} ──`);
  for (const { edital, extracao } of resultadosSonnet) console.log(linhaEdital(edital, extracao, LIMIAR_CONFIANCA_PADRAO));
  const { por: porSonnet, global: globalSonnet } = calcularMetricas(resultadosSonnet, LIMIAR_CONFIANCA_PADRAO);
  imprimirTabela(porSonnet, globalSonnet);

  console.log(`\n── ${MODELO_B} ──`);
  for (const { edital, extracao } of resultadosOpus) console.log(linhaEdital(edital, extracao, LIMIAR_CONFIANCA_PADRAO));
  const { por: porOpus, global: globalOpus } = calcularMetricas(resultadosOpus, LIMIAR_CONFIANCA_PADRAO);
  imprimirTabela(porOpus, globalOpus);

  const campo = (por: Metricas[], nome: string): Metricas =>
    por.find((m) => m.campo === nome) ?? {
      campo: nome, total: 0, tp: 0, fp: 0, fn: 0, alucinacoesNumericas: 0, recall: 0, precisao: 1,
    };
  const mValorSonnet = campo(porSonnet, 'valorEstimado');
  const mValorOpus = campo(porOpus, 'valorEstimado');
  const mDataSonnet = campo(porSonnet, 'dataAberturaPropostas');
  const mDataOpus = campo(porOpus, 'dataAberturaPropostas');
  const mHabSonnet = campo(porSonnet, 'habilitacao');
  const mHabOpus = campo(porOpus, 'habilitacao');

  const confSonnet = confiancaGlobalMedia(resultadosSonnet);
  const confOpus = confiancaGlobalMedia(resultadosOpus);
  const custoSonnet = custoTotalUsd(resultadosSonnet);
  const custoOpus = custoTotalUsd(resultadosOpus);

  console.log(`\n══════════════════════════ DELTA (${MODELO_A} vs. ${MODELO_B}) ═══════════════════════════`);
  console.log(linhaDelta('confiancaGlobal média', confSonnet, confOpus));
  console.log(linhaDelta('valorEstimado — recall', mValorSonnet.recall, mValorOpus.recall));
  console.log(linhaDelta('valorEstimado — precisão', mValorSonnet.precisao, mValorOpus.precisao));
  console.log(linhaDelta('dataAberturaPropostas — recall', mDataSonnet.recall, mDataOpus.recall));
  console.log(linhaDelta('dataAberturaPropostas — precisão', mDataSonnet.precisao, mDataOpus.precisao));
  console.log(linhaDelta('habilitação — recall', mHabSonnet.recall, mHabOpus.recall));
  console.log(
    `  ${'alucinações numéricas (soma dos campos)'.padEnd(40)} ${MODELO_A} ${globalSonnet.alucinacoesNumericas}  vs  ${MODELO_B} ${globalOpus.alucinacoesNumericas}`,
  );
  console.log(
    `  ${'custo total (USD, este run)'.padEnd(40)} ${MODELO_A} US$ ${custoSonnet.toFixed(4)}  vs  ${MODELO_B} US$ ${custoOpus.toFixed(4)}  (${MODELO_A} ${custoOpus > 0 ? (((custoSonnet - custoOpus) / custoOpus) * 100).toFixed(0) : 'n/d'}%)`,
  );
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  if (resultadosSonnet.length < DATASET.length || resultadosOpus.length < DATASET.length) {
    console.warn('⚠ Alguma extração falhou em um dos modelos — delta calculado só sobre o que respondeu.');
  }
  console.log(
    `⚠ N=${DATASET.length} (bootstrap hand-authored, P-18 Aberto) — não é validação em escala. ` +
      'Ver RAD-337 para a leitura completa e a recomendação.',
  );
}

main().catch((err) => {
  console.error('comparativo de modelo falhou:', err);
  process.exitCode = 1;
});
