/**
 * RECORD driver do gold set (A16 / A17 §7) — companion credenciado do `RecordReplayLlmClient` (RAD-140).
 *
 * Roda editais REAIS pelo pipeline real de extração UMA vez, grava a saída CRUA do LLM por caso e
 * persiste um arquivo de fixtures que o REPLAY do CI carrega de forma determinística (sem rede, sem
 * custo). É a metade credenciada do seam: `RecordReplayLlmClient` tem o modo RECORD, mas sozinho não
 * roda — precisa deste composition root para ligar o SDK real como `delegate`.
 *
 * Composition root (P-74): só AQUI o `@anthropic-ai/sdk` é importado; o SDK liga-se ao seam
 * `MessagesClient` do `AnthropicSdkClient`, que o `RecordReplayLlmClient` usa como `delegate`. Fica
 * fora de `src/` → não entra no build/lint/typecheck do módulo (como o smoke).
 *
 * Framework-agnóstico (não pressupõe P-85): o formato do arquivo é uma convenção de PARTIDA; a
 * orquestração/score do eval (Braintrust/Phoenix/custom) é decisão de P-85 (Quésia/A16). Os RÓTULOS
 * (recall/precisão vs. gold set) também são de Quésia — este driver só captura as saídas do LLM.
 *
 * REPLAY carrega as fixtures assim:
 *   const { casos } = JSON.parse(readFileSync(saida, 'utf8'));
 *   const client = new RecordReplayLlmClient(new Map(casos.map((c) => [c.chave, c.saida])));
 *
 * PRÉ-REQUISITOS: `ANTHROPIC_API_KEY` no ambiente (ou `ant auth login`) e acesso de rede.
 * RODAR: pnpm --filter @radar/triagem exec tsx scripts/gravar-fixtures-gold-set.ts [dataset.json] [saida.json]
 *   dataset.json : EntradaExtracaoDTO[] (default: 1 edital de exemplo embutido)
 *   saida.json   : arquivo de fixtures (default: scripts/fixtures-gold-set.json)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import type { EntradaExtracaoDTO } from '../src/application/index.js';
import {
  AnthropicSdkClient,
  RecordReplayLlmClient,
  chavePorConteudo,
  interpretarSaidaExtracao,
  montarRequisicaoExtracao,
} from '../src/infra/index.js';
import type { MessagesClient } from '../src/infra/index.js';

/** Edital de exemplo — default quando nenhum dataset é passado (mesmo do smoke). */
const EXEMPLO: EntradaExtracaoDTO = {
  editalId: 'gold-exemplo-1',
  texto: [
    'PREGÃO ELETRÔNICO Nº 12/2026 — PREFEITURA MUNICIPAL DE EXEMPLO',
    '1. DO OBJETO: aquisição de 50 (cinquenta) notebooks para as escolas municipais.',
    '2. DO VALOR ESTIMADO: R$ 250.000,00 (duzentos e cinquenta mil reais).',
    '3. DA SESSÃO: a abertura das propostas ocorrerá em 15/03/2026 às 09h00.',
    '4. DA HABILITAÇÃO FISCAL: exige-se Certidão Negativa de Débitos (CND) federal válida.',
  ].join('\n'),
  temTextoSelecionavel: true,
  anexos: [],
  paginas: 1,
};

function carregarDataset(caminho: string | undefined): EntradaExtracaoDTO[] {
  if (caminho === undefined) return [EXEMPLO];
  const bruto: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
  if (!Array.isArray(bruto)) throw new Error(`${caminho} não é um array de EntradaExtracaoDTO`);
  return bruto as EntradaExtracaoDTO[];
}

async function main(): Promise<void> {
  const [datasetPath, saidaPath = 'scripts/fixtures-gold-set.json'] = process.argv.slice(2);
  const dataset = carregarDataset(datasetPath);
  const signal = new AbortController().signal;

  // Composition root: liga o SDK real ao seam e usa-o como delegate do RECORD.
  const anthropic = new Anthropic();
  const sdkClient = new AnthropicSdkClient(anthropic.messages as unknown as MessagesClient);

  const gravado = new Map<string, unknown>();
  const editalPorChave = new Map<string, string>();
  const client = new RecordReplayLlmClient(new Map(), {
    delegate: sdkClient,
    onRecord: (chave, saidaCrua) => gravado.set(chave, saidaCrua),
  });

  console.log(`→ gravando ${dataset.length} edital(is) via LLM real (RECORD)…`);
  for (const entrada of dataset) {
    const req = montarRequisicaoExtracao(entrada);
    editalPorChave.set(chavePorConteudo(req), entrada.editalId);
    const saidaCrua = await client.extrairViaFerramenta(req, signal); // cache-miss → SDK real → onRecord
    // Sanidade (o REPLAY revalida): a saída real passa na camada 3? Só avisa, não interrompe a gravação.
    try {
      interpretarSaidaExtracao(saidaCrua, entrada);
    } catch (err) {
      console.warn(`⚠ ${entrada.editalId}: saída não passou no schema (camada 3) — ${String(err)}`);
    }
    console.log(`✓ ${entrada.editalId}`);
  }

  const casos = [...gravado].map(([chave, saida]) => ({
    editalId: editalPorChave.get(chave) ?? null,
    chave,
    saida,
  }));
  const arquivo = { gravadoEm: new Date().toISOString(), total: casos.length, casos };
  writeFileSync(saidaPath, `${JSON.stringify(arquivo, null, 2)}\n`, 'utf8');
  console.log(`\n✅ ${casos.length} fixture(s) gravada(s) em ${saidaPath}`);
}

main().catch((err) => {
  console.error('gravação de fixtures falhou:', err);
  process.exitCode = 1;
});
