/**
 * Comparativo RASO vs. COMPLETO do gold set — mede o ganho da RAD-282 (P-110): antes, a Triagem
 * extraía do `objeto`/metadados do PNCP (raso); depois, do texto real do anexo (completo, o que
 * `avaliar-gold-set-vivo.ts` já roda e o `tools/pipeline-local` agora liga de verdade). Mesmo
 * DATASET, mesmo LLM real, dois `EntradaExtracaoDTO` por edital:
 *   raso     = só `objetoResumo` (o que `ContratacaoData.objeto` do PNCP carrega) — sem valor/data.
 *   completo = `texto` inteiro do documento.
 *
 * Reporta o delta de `confiancaGlobal` média, % de campos exibidos como fato (vs. "verificar") e
 * precisão/recall de `valorEstimado`/`dataAberturaPropostas` — a medição pedida pela RAD-282.
 *
 * PRÉ-REQUISITOS: ANTHROPIC_API_KEY (ver avaliar-gold-set-vivo.ts). Roda o dataset 2×, consome
 * tokens reais nas duas passadas.
 * RODAR: pnpm --filter @radar/triagem avaliar:gold-set:vivo:comparativo
 */
import Anthropic from '@anthropic-ai/sdk';
import type { EntradaExtracaoDTO } from '../src/application/index.js';
import { LIMIAR_CONFIANCA_PADRAO } from '../src/application/index.js';
import type { ExtracaoEdital } from '../src/domain/index.js';
import { AnthropicLlmGateway, AnthropicSdkClient } from '../src/infra/index.js';
import type { MessagesClient } from '../src/infra/index.js';
import { DATASET, type EditalGabarito } from './gold-set/dataset.js';
import {
  calcularMetricas,
  confiancaGlobalMedia,
  fracaoExibivelComoFato,
  imprimirTabela,
  linhaEdital,
  pct,
  type Metricas,
} from './gold-set/metricas.js';

type Variante = 'raso' | 'completo';

/**
 * RASO mimetiza o `textoEdital()` que `tools/pipeline-local/src/rodar.ts` usava ANTES da RAD-282:
 * só o que `ContratacaoData` do PNCP entrega sem baixar/ler o anexo (modalidade, valor — quando o
 * PNCP o expõe — e o `objeto`). SEM data de abertura: o metadado de nível de compra do PNCP não
 * carrega `dataAberturaPropostas` (só `dataPublicacao`/`prazoProposta`) — por isso esse campo, no
 * fluxo antigo, nunca tinha de onde vir.
 */
function entradaParaVariante(edital: EditalGabarito, variante: Variante): EntradaExtracaoDTO {
  if (variante === 'completo') {
    return {
      editalId: edital.id,
      texto: edital.texto,
      temTextoSelecionavel: true,
      anexos: [],
      paginas: edital.paginas,
    };
  }
  const valor =
    edital.gabarito.valorEstimado != null
      ? `R$ ${edital.gabarito.valorEstimado.toLocaleString('pt-BR')}`
      : 'não informado';
  const texto = [
    `Modalidade: ${edital.modalidade}`,
    `Valor estimado: ${valor}`,
    `Objeto: ${edital.objetoResumo}`,
  ].join('\n');
  return { editalId: edital.id, texto, temTextoSelecionavel: true, anexos: [], paginas: 1 };
}

async function extrairVariante(
  gateway: AnthropicLlmGateway,
  variante: Variante,
  signal: AbortSignal,
): Promise<{ edital: EditalGabarito; extracao: ExtracaoEdital }[]> {
  const resultados: { edital: EditalGabarito; extracao: ExtracaoEdital }[] = [];
  for (const edital of DATASET) {
    const entrada = entradaParaVariante(edital, variante);
    process.stdout.write(`  → [${variante}] ${edital.id}… `);
    try {
      const { extracao } = await gateway.extrair(entrada, signal);
      resultados.push({ edital, extracao });
      console.log('ok');
    } catch (err) {
      console.log(`FALHOU — ${String(err)}`);
    }
  }
  return resultados;
}

function linhaDelta(rotulo: string, antes: number, depois: number): string {
  const delta = depois - antes;
  const sinal = delta >= 0 ? '+' : '';
  return `  ${rotulo.padEnd(40)} ${pct(antes).padStart(7)}  →  ${pct(depois).padStart(7)}   (${sinal}${pct(delta)})`;
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY ausente. Exporte antes de rodar:\n  set -a; source .env.local; set +a');
    process.exitCode = 1;
    return;
  }

  const anthropic = new Anthropic();
  const gateway = new AnthropicLlmGateway(
    new AnthropicSdkClient(anthropic.messages as unknown as MessagesClient),
  );
  const signal = new AbortController().signal;

  console.log('╔══════════════════════════════════════════════════════════════════════════╗');
  console.log('║  COMPARATIVO — texto RASO (metadado PNCP) vs. COMPLETO (anexo real)        ║');
  console.log('║  Mede o ganho de RAD-282/P-110 no mesmo gold set de bootstrap (P-18)       ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');

  console.log('▸ Variante RASO (objeto/metadado PNCP — o que a Triagem lia antes de RAD-282)');
  const resultadosRaso = await extrairVariante(gateway, 'raso', signal);

  console.log('\n▸ Variante COMPLETO (texto do anexo real — o que RAD-282 liga no pipeline-local)');
  const resultadosCompleto = await extrairVariante(gateway, 'completo', signal);

  if (resultadosRaso.length === 0 || resultadosCompleto.length === 0) {
    console.error('\nUma das variantes não produziu nenhuma extração — abortando o comparativo.');
    process.exitCode = 1;
    return;
  }

  console.log('\n── RASO ──');
  for (const { edital, extracao } of resultadosRaso) {
    console.log(linhaEdital(edital, extracao, LIMIAR_CONFIANCA_PADRAO));
  }
  const { por: porRaso, global: globalRaso } = calcularMetricas(resultadosRaso, LIMIAR_CONFIANCA_PADRAO);
  imprimirTabela(porRaso, globalRaso);

  console.log('\n── COMPLETO ──');
  for (const { edital, extracao } of resultadosCompleto) {
    console.log(linhaEdital(edital, extracao, LIMIAR_CONFIANCA_PADRAO));
  }
  const { por: porCompleto, global: globalCompleto } = calcularMetricas(resultadosCompleto, LIMIAR_CONFIANCA_PADRAO);
  imprimirTabela(porCompleto, globalCompleto);

  const campo = (por: Metricas[], nome: string): Metricas =>
    por.find((m) => m.campo === nome) ?? {
      campo: nome, total: 0, tp: 0, fp: 0, fn: 0, alucinacoesNumericas: 0, recall: 0, precisao: 1,
    };
  const mValorRaso = campo(porRaso, 'valorEstimado');
  const mValorCompleto = campo(porCompleto, 'valorEstimado');
  const mDataRaso = campo(porRaso, 'dataAberturaPropostas');
  const mDataCompleto = campo(porCompleto, 'dataAberturaPropostas');

  const confRaso = confiancaGlobalMedia(resultadosRaso);
  const confCompleto = confiancaGlobalMedia(resultadosCompleto);
  const exibRaso = fracaoExibivelComoFato(resultadosRaso, LIMIAR_CONFIANCA_PADRAO);
  const exibCompleto = fracaoExibivelComoFato(resultadosCompleto, LIMIAR_CONFIANCA_PADRAO);

  console.log('\n══════════════════════════ DELTA (raso → completo) ═══════════════════════════');
  console.log(linhaDelta('confiancaGlobal média', confRaso, confCompleto));
  console.log(
    linhaDelta(
      '% exibível como fato (vs. "verificar")',
      exibRaso.total > 0 ? exibRaso.exibiveis / exibRaso.total : 0,
      exibCompleto.total > 0 ? exibCompleto.exibiveis / exibCompleto.total : 0,
    ),
  );
  console.log(`    (${exibRaso.exibiveis}/${exibRaso.total} raso  →  ${exibCompleto.exibiveis}/${exibCompleto.total} completo)`);
  console.log(linhaDelta('valorEstimado — recall', mValorRaso.recall, mValorCompleto.recall));
  console.log(linhaDelta('valorEstimado — precisão', mValorRaso.precisao, mValorCompleto.precisao));
  console.log(linhaDelta('dataAberturaPropostas — recall', mDataRaso.recall, mDataCompleto.recall));
  console.log(linhaDelta('dataAberturaPropostas — precisão', mDataRaso.precisao, mDataCompleto.precisao));
  console.log('════════════════════════════════════════════════════════════════════════════\n');

  if (resultadosRaso.length < DATASET.length || resultadosCompleto.length < DATASET.length) {
    console.warn('⚠ Alguma extração falhou em uma das variantes — delta calculado só sobre o que respondeu.');
  }
}

main().catch((err) => {
  console.error('comparativo falhou:', err);
  process.exitCode = 1;
});
