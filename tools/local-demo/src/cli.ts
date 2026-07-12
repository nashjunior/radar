#!/usr/bin/env node
/**
 * CLI local: PNCP (todas modalidades) → filtro seed → Gemini → Triagem.avaliar
 * Subcomando: ask "<pergunta>" — chat grounded no lote.
 *
 * Uso:
 *   pnpm --filter @radar/local-demo start
 *   pnpm --filter @radar/local-demo run ask -- "o que serve pra TI em SP?"
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perguntarSobreLote } from './ask.js';
import {
  carregarConfig,
  executarPipeline,
  resumoLoteParaChat,
  type LoteDemo,
} from './pipeline.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, '..', '.cache', 'ultimo-lote.json');

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sub = args[0];

  if (sub === 'ask') {
    const pergunta = args.slice(1).join(' ').trim();
    if (!pergunta) {
      console.error('Uso: pnpm --filter @radar/local-demo run ask -- "sua pergunta"');
      process.exit(1);
    }
    await cmdAsk(pergunta);
    return;
  }

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    imprimirAjuda();
    return;
  }

  await cmdStart();
}

async function cmdStart(): Promise<void> {
  const config = carregarConfig();
  console.log('[local-demo] Coletando PNCP (modalidades 1–13)…');
  console.log(
    `  janela=${config.janelaDias}d max=${config.maxEditais} triar=${config.triarMax} modelo=${config.geminiModel}`,
  );
  if (config.filtro.palavrasChave.length || config.filtro.uf || config.filtro.valorMax != null) {
    console.log('  filtro:', JSON.stringify(config.filtro));
  }

  const lote = await executarPipeline(config);
  persistirLote(lote);

  console.log(`\nColetados: ${lote.coletados.length} | Filtrados: ${lote.filtrados.length}`);
  console.log('\n--- Amostra filtrada ---');
  for (const c of lote.filtrados.slice(0, 15)) {
    console.log(
      `• ${c.numeroControlePncp} | mod ${c.modalidadeCodigo} | ${c.orgao.uf} | ` +
        `${c.valorEstimado ?? 'n/d'} | ${c.objeto.slice(0, 100)}`,
    );
  }

  console.log('\n--- Triagem Gemini ---');
  if (lote.triagens.length === 0) {
    console.log('(nenhum edital para triar — ajuste DEMO_PALAVRAS_CHAVE / DEMO_TRIAR_MAX)');
  }
  for (const t of lote.triagens) {
    const n = t.contratacao.numeroControlePncp;
    if (t.erro) {
      console.log(`✗ ${n}: ERRO ${t.erro}`);
      continue;
    }
    console.log(
      `✓ ${n}: ${t.recomendacao?.toUpperCase()} aderência=${t.aderencia?.toFixed(2)} ` +
        `confiança=${t.confianca?.toFixed(2)}`,
    );
    console.log(`  objeto: ${t.objetoExtraido}`);
    if (t.riscos.length) {
      console.log(`  lacunas: ${t.riscos.slice(0, 3).join('; ')}`);
    }
  }

  console.log(`\nLote em cache: ${CACHE_PATH}`);
  console.log(
    'Depois: pnpm --filter @radar/local-demo run ask -- "o que combina com minha empresa?"',
  );
}

async function cmdAsk(pergunta: string): Promise<void> {
  const config = carregarConfig();
  let lote = lerLoteCache();
  if (!lote) {
    console.log('[local-demo] Sem cache — rodando pipeline antes do ask…');
    lote = await executarPipeline(config);
    persistirLote(lote);
  }

  const contexto = resumoLoteParaChat(lote);
  console.log(`[local-demo] Perguntando ao Gemini sobre ${lote.filtrados.length} editais filtrados…\n`);
  const resposta = await perguntarSobreLote({
    apiKey: config.geminiApiKey,
    modelo: config.geminiModel,
    pergunta,
    contextoEditais: contexto,
    nodeEnv: process.env['NODE_ENV'] ?? 'development',
  });
  console.log(resposta);
}

function persistirLote(lote: LoteDemo): void {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(lote, dateReplacer, 2), 'utf8');
}

function lerLoteCache(): LoteDemo | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'), dateReviver) as LoteDemo;
  } catch {
    return null;
  }
}

function dateReplacer(_k: string, v: unknown): unknown {
  return v instanceof Date ? { __date: v.toISOString() } : v;
}

function dateReviver(_k: string, v: unknown): unknown {
  if (typeof v === 'object' && v !== null && '__date' in v) {
    return new Date((v as { __date: string }).__date);
  }
  return v;
}

function imprimirAjuda(): void {
  console.log(`@radar/local-demo — PNCP amplo + Gemini local + chat

Comandos:
  start (default)  Coleta PNCP → filtra → tria com Gemini → imprime go/no-go
  ask "…"          Chat grounded no último lote (cache .cache/ultimo-lote.json)
  help             Esta ajuda

Env: ver .env.example / README.md
`);
}

main().catch((err) => {
  console.error('[local-demo] falhou:', err instanceof Error ? err.message : err);
  process.exit(1);
});
