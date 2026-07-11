/**
 * CLI de calibração do limiar de confiança (P-19 · A16 §2.4).
 *
 * Lê um gold set ROTULADO (formato: GoldSet de calibrar-limiar.ts) e imprime:
 *   — a curva recall × limiar
 *   — o limiar ótimo (maior corte com recall ≥ 95% E zero alucinação numérica)
 *   — comparação com LIMIAR_CONFIANCA_PADRAO atual
 *
 * RODAR:
 *   pnpm --filter @radar/triagem calibrar:limiar [gold-set-rotulado.json]
 *   (default: scripts/fixtures/gold-set-rotulado-sintetico.json)
 */
import { readFileSync } from 'node:fs';
import { calibrar, varreLimiar } from './calibrar-limiar.js';
import type { GoldSet } from './calibrar-limiar.js';
import { LIMIAR_CONFIANCA_PADRAO } from '../src/application/politica-confianca.js';

const META_RECALL = 0.95;

function carregarGoldSet(caminho: string): GoldSet {
  const bruto: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
  if (
    typeof bruto !== 'object' ||
    bruto === null ||
    !('editais' in bruto) ||
    !Array.isArray((bruto as { editais: unknown }).editais)
  ) {
    throw new Error(`${caminho} não é um GoldSet válido`);
  }
  return bruto as GoldSet;
}

function fmt(n: number, decimais = 4): string {
  return n.toFixed(decimais);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function main(): void {
  const [caminhoArg] = process.argv.slice(2);
  const caminho =
    caminhoArg ?? 'scripts/fixtures/gold-set-rotulado-sintetico.json';

  const gs = carregarGoldSet(caminho);
  const { meta, editais } = gs;

  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  Calibração do LIMIAR_CONFIANCA_PADRAO (P-19 / A16)  ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);
  console.log(`Gold set  : ${meta.tipo} · ${meta.protocolo}`);
  console.log(`Editais   : ${editais.length} (gold set tem ${meta.totalEditais})`);
  console.log(`Gerado em : ${meta.geradoEm}`);
  console.log(`Meta recall: ≥ ${pct(META_RECALL)}\n`);

  const resultado = calibrar(editais, META_RECALL);
  const curva = varreLimiar(editais);

  // Exibe curva compacta (de 0,55 a 0,85, em passos de 0,01)
  console.log('Curva recall × limiar (campos críticos, 0,55–0,85):');
  console.log('  limiar | recall  | precisão | aluc.num');
  console.log('  -------|---------|----------|---------');
  for (const p of curva) {
    if (p.limiar < 0.55 || p.limiar > 0.85) continue;
    const marker =
      p.limiar === resultado.limiarOtimo
        ? ' ◄ ÓTIMO'
        : p.limiar === LIMIAR_CONFIANCA_PADRAO
          ? ' ◄ atual'
          : '';
    console.log(
      `  ${fmt(p.limiar, 2)}  | ${pct(p.recall).padEnd(7)} | ${pct(p.precisao).padEnd(8)} | ${p.alucinacoesNumericas}${marker}`,
    );
  }

  console.log(`\n─────────────────────────────────────────────────────`);
  console.log(`Limiar ótimo  : ${fmt(resultado.limiarOtimo, 2)}`);
  console.log(`Recall        : ${pct(resultado.recallNoLimiar)} (meta: ≥ ${pct(META_RECALL)})`);
  console.log(`Precisão      : ${pct(resultado.precisaoNoLimiar)}`);
  console.log(`Aluc. numér.  : ${resultado.alucinacoesNoLimiar} (meta: 0)`);
  console.log(`Total críticos: ${resultado.totalCamposCriticos}`);

  const atual = LIMIAR_CONFIANCA_PADRAO;
  const pontoAtual = curva.find((p) => Math.round(p.limiar * 100) === Math.round(atual * 100));
  if (pontoAtual) {
    console.log(`\nComparação com valor atual (${fmt(atual, 2)}):`);
    console.log(`  recall    : ${pct(pontoAtual.recall)}`);
    console.log(`  precisão  : ${pct(pontoAtual.precisao)}`);
    console.log(`  aluc.num. : ${pontoAtual.alucinacoesNumericas}`);
  }

  console.log('\n─────────────────────────────────────────────────────');
  if (!resultado.metaRecallAtingida) {
    console.log('⚠️  ATENÇÃO: recall abaixo de 95% em TODOS os limiares.');
    console.log('   Gold set insuficiente ou qualidade de extração abaixo da meta.');
    process.exitCode = 1;
  } else if (!resultado.zeroAlucinacaoNumerica) {
    console.log('⚠️  ATENÇÃO: alucinação numérica detectada no limiar ótimo.');
    console.log('   Elevar limiar ou aplicar corte separado por classe numérica.');
    process.exitCode = 1;
  } else if (resultado.limiarOtimo === atual) {
    console.log(`✅  LIMIAR_CONFIANCA_PADRAO = ${fmt(atual, 2)} CONFIRMADO pela calibração.`);
    console.log('   Nenhuma atualização de código necessária.');
  } else {
    console.log(
      `⚡  LIMIAR sugerido: ${fmt(resultado.limiarOtimo, 2)} (atual: ${fmt(atual, 2)}).`,
    );
    console.log(
      `   Atualizar LIMIAR_CONFIANCA_PADRAO em src/application/politica-confianca.ts.`,
    );
    if (resultado.limiarOtimo < atual) {
      process.exitCode = 0; // limiar mais permissivo: aceitável
    }
  }
  console.log('');
}

main();
