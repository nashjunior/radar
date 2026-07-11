/**
 * Smoke-test da extração via Message Batches (RAD-54 · Lever 1 de RAD-53).
 *
 * Como a inferência é IDÊNTICA à do caminho síncrono (mesmo `model`/`system`/`INSTRUCAO_EXTRACAO`/
 * schema — só muda o transporte), a barra aqui é smoke-test, NÃO gold-set (A16): roda 1 edital real
 * pelos dois caminhos e compara o SHAPE do agregado. Valores não são comparados (LLM é não-determinístico).
 *
 * Este arquivo É o composition root do smoke: só ele importa `@anthropic-ai/sdk` (P-74 — o SDK fica
 * fora do boundary do módulo; os adapters usam interfaces mínimas). Fica fora de `src/`, então não
 * entra no build (`tsc -p tsconfig.json`, include: ["src"]).
 *
 * PRÉ-REQUISITOS: `ANTHROPIC_API_KEY` no ambiente (ou `ant auth login`) e acesso de rede. O lote é
 * assíncrono e pode levar minutos.
 *
 * RODAR:  pnpm --filter @radar/triagem exec tsx scripts/smoke-extracao-batch.ts
 *         (ou: npx tsx modules/triagem/scripts/smoke-extracao-batch.ts)
 */
import Anthropic from '@anthropic-ai/sdk';
import type { EntradaExtracaoDTO } from '../src/application/index.js';
import type { ExtracaoEdital } from '../src/domain/index.js';
import {
  AnthropicBatchLlmGateway,
  AnthropicLlmGateway,
  AnthropicSdkClient,
} from '../src/infra/index.js';
import type { MessageBatchesClient, MessagesClient } from '../src/infra/index.js';

const EDITAL_TEXTO = [
  'PREGÃO ELETRÔNICO Nº 12/2026 — PREFEITURA MUNICIPAL DE EXEMPLO',
  '1. DO OBJETO: aquisição de 50 (cinquenta) notebooks para as escolas municipais.',
  '2. DO VALOR ESTIMADO: R$ 250.000,00 (duzentos e cinquenta mil reais).',
  '3. DA SESSÃO: a abertura das propostas ocorrerá em 15/03/2026 às 09h00.',
  '4. DA HABILITAÇÃO FISCAL: exige-se Certidão Negativa de Débitos (CND) federal válida.',
].join('\n');

const entrada: EntradaExtracaoDTO = {
  editalId: 'smoke-edital-1',
  texto: EDITAL_TEXTO,
  temTextoSelecionavel: true,
  anexos: [],
  paginas: 1,
};

/** Fingerprint estrutural (tipos, não valores) — é o que o smoke compara entre os dois transportes. */
function shape(e: ExtracaoEdital): Record<string, string> {
  const tipo = (v: unknown): string =>
    v === null ? 'null' : v instanceof Date ? 'Date' : Array.isArray(v) ? 'array' : typeof v;
  return {
    editalId: tipo(e.editalId),
    objeto: tipo(e.objeto.valor),
    valorEstimado: tipo(e.valorEstimado.valor),
    dataAberturaPropostas: tipo(e.dataAberturaPropostas.valor),
    confiancaGlobal: tipo(e.confiancaGlobal().valor),
    requisitos: tipo(e.requisitos),
    riscos: tipo(e.riscosBrutos),
    paginas: tipo(e.paginas),
  };
}

async function main(): Promise<void> {
  const anthropic = new Anthropic();
  const signal = new AbortController().signal;

  // --- Caminho SÍNCRONO (baseline): AnthropicSdkClient real — streaming + strict + refusal + thinking (RAD-55) ---
  // O composition root liga o SDK ao seam `MessagesClient` (P-74; `anthropic.messages` casa estruturalmente).
  const syncClient = new AnthropicSdkClient(anthropic.messages as unknown as MessagesClient);
  console.log('→ extração SÍNCRONA (baseline · AnthropicSdkClient)…');
  const sync = await new AnthropicLlmGateway(syncClient).extrair(entrada, signal);

  // --- Caminho em LOTE (RAD-54): mesma inferência, transporte via Message Batches ---
  console.log('→ extração em LOTE (Message Batches)… pode levar minutos');
  const batchGateway = new AnthropicBatchLlmGateway(
    anthropic.messages.batches as unknown as MessageBatchesClient,
    { intervaloPollMs: 10_000 },
  );
  const [resultado] = await batchGateway.extrairLote([entrada], signal);
  if (resultado === undefined || !resultado.ok) {
    throw new Error(`lote não produziu extração: ${resultado ? resultado.motivo : 'vazio'}`);
  }

  const shapeSync = shape(sync);
  const shapeBatch = shape(resultado.extracao);
  const iguais = JSON.stringify(shapeSync) === JSON.stringify(shapeBatch);

  console.log('\nshape síncrono:', shapeSync);
  console.log('shape lote:    ', shapeBatch);
  console.log(`\n${iguais ? '✅ PASS' : '❌ FAIL'} — shapes ${iguais ? 'idênticos' : 'DIVERGENTES'}`);
  if (!iguais) process.exitCode = 1;
}

main().catch((err) => {
  console.error('smoke falhou:', err);
  process.exitCode = 1;
});
