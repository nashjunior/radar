/**
 * Eval AO VIVO do gold set — extração REAL (AnthropicSdkClient → AnthropicLlmGateway, camadas 1–6)
 * sobre editais reais rotulados, pontuando precisão/recall/alucinação contra um GABARITO de valores.
 * SEM mock de LLM (nada de RecordReplay). Complementa o replay sintético do
 * `precisao-recall-gold-set.eval.test.ts` (RAD-204): lá o LLM é sintetizado a partir dos rótulos;
 * aqui o modelo roda de verdade e o rótulo é o valor ESPERADO por campo.
 *
 * Dataset e métricas vivem em `./gold-set/` (RAD-282) — reusados também por
 * `avaliar-gold-set-vivo-comparativo.ts` (mede o ganho do texto real do anexo vs. metadado raso).
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
import { AnthropicLlmGateway, AnthropicSdkClient } from '../src/infra/index.js';
import type { MessagesClient } from '../src/infra/index.js';
import { DATASET, type EditalGabarito } from './gold-set/dataset.js';
import { calcularMetricas, imprimirTabela, linhaEdital, marca, pct, GATE_PRECISAO, GATE_RECALL } from './gold-set/metricas.js';

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
  for (const { edital, extracao } of resultados) console.log(linhaEdital(edital, extracao, LIMIAR_CONFIANCA_PADRAO));

  const { por, global } = calcularMetricas(resultados, LIMIAR_CONFIANCA_PADRAO);
  imprimirTabela(por, global);

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
