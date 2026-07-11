/**
 * RECORD driver do gold set via claude CLI — sem ANTHROPIC_API_KEY (RAD-139).
 *
 * Usa o `ClaudeCliLlmClient` como delegate do `RecordReplayLlmClient` (modo RECORD):
 * chama o claude CLI autenticado (Claude Code) por edital, grava a saída crua e persiste
 * o arquivo de fixtures. O REPLAY no CI usa essas fixtures sem CLI nem rede.
 *
 * Diferenças vs. `gravar-fixtures-gold-set.ts` (SDK direto):
 *   — Não precisa de ANTHROPIC_API_KEY (usa autenticação do Claude Code)
 *   — Usa Haiku por default (mais barato; sem tool_use)
 *   — Parsing heurístico de JSON (sem structured output garantido pelo schema)
 *   — Cada edital é um subprocess — mais lento que batch
 *
 * RODAR:
 *   pnpm --filter @radar/triagem fixtures:gold-set:cli [dataset.json] [saida.json]
 *   dataset.json : EntradaExtracaoDTO[] (default: dataset-exemplo.json embutido)
 *   saida.json   : fixtures (default: scripts/fixtures/gold-set-raw-cli.json)
 *
 * PRÉ-REQUISITO: `claude` CLI instalado e autenticado (Claude Code 2.x+).
 *   Verifique com: claude --version
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EntradaExtracaoDTO } from '../src/application/index.js';
import {
  RecordReplayLlmClient,
  chavePorConteudo,
  interpretarSaidaExtracao,
  montarRequisicaoExtracao,
} from '../src/infra/index.js';
import { ClaudeCliLlmClient } from './claude-cli-llm-client.js';

/** Dataset mínimo de exemplo — cobre modalidades e formatos distintos (A16 §2.1). */
const DATASET_EXEMPLO: EntradaExtracaoDTO[] = [
  {
    editalId: 'gold-cli-001',
    texto: [
      'PREGÃO ELETRÔNICO Nº 12/2026 — PREFEITURA MUNICIPAL DE EXEMPLO',
      '1. DO OBJETO: aquisição de 50 (cinquenta) notebooks para as escolas municipais.',
      '2. DO VALOR ESTIMADO: R$ 250.000,00 (duzentos e cinquenta mil reais).',
      '3. DA SESSÃO: a abertura das propostas ocorrerá em 15/03/2026 às 09h00.',
      '4. DA HABILITAÇÃO FISCAL: exige-se Certidão Negativa de Débitos (CND) federal válida.',
      '5. PENALIDADES: multa de 10% sobre o valor do contrato em caso de inexecução total.',
    ].join('\n'),
    temTextoSelecionavel: true,
    anexos: [],
    paginas: 2,
  },
  {
    editalId: 'gold-cli-002',
    texto: [
      'CONCORRÊNCIA Nº 03/2026 — GOVERNO DO ESTADO DE EXEMPLO',
      '1. OBJETO: contratação de empresa para execução de obras de reforma na Escola Estadual Central.',
      '2. VALOR ESTIMADO: SIGILOSO (art. 24 da Lei 14.133/2021).',
      '3. DATA DE ABERTURA: 20 de abril de 2026, às 14h, na sede da Secretaria de Obras.',
      '4. HABILITAÇÃO TÉCNICA: atestado de capacidade técnica em obras de reforma de edificações.',
      '5. HABILITAÇÃO ECONÔMICA: capital social mínimo de R$ 500.000,00 ou patrimônio líquido equivalente.',
    ].join('\n'),
    temTextoSelecionavel: true,
    anexos: [],
    paginas: 3,
  },
  {
    editalId: 'gold-cli-003',
    texto: [
      'DISPENSA DE LICITAÇÃO Nº 05/2026 — AUTARQUIA FEDERAL DE EXEMPLO',
      '1. OBJETO: contratação de empresa de consultoria em tecnologia da informação.',
      '2. VALOR: R$ 40.000,00 (quarenta mil reais) — enquadrado no art. 75, II, Lei 14.133/2021.',
      '3. PRAZO: o serviço deverá ser entregue em 30 dias a partir da assinatura do contrato.',
      '4. HABILITAÇÃO JURÍDICA: certidão de registro no CNPJ e contrato social atualizado.',
    ].join('\n'),
    temTextoSelecionavel: true,
    anexos: [],
    paginas: 1,
  },
  {
    editalId: 'gold-cli-004',
    texto: [
      'INEXIGIBILIDADE Nº 02/2026 — MUNICÍPIO DE EXEMPLO',
      '1. OBJETO: contratação de palestrante especialista em governança pública para evento institucional.',
      '2. VALOR: R$ 15.000,00 (quinze mil reais).',
      '3. JUSTIFICATIVA: notória especialização do contratado (art. 74, III, "d", Lei 14.133/2021).',
      '4. PRAZO DA PRESTAÇÃO: 10 de maio de 2026.',
    ].join('\n'),
    temTextoSelecionavel: true,
    anexos: [],
    paginas: 1,
  },
  {
    editalId: 'gold-cli-005',
    texto: [
      'PREGÃO ELETRÔNICO Nº 88/2026 — AUTARQUIA MUNICIPAL DE SAÚDE',
      '1. OBJETO: aquisição de medicamentos (insulina, metformina e losartana) para a rede básica de saúde.',
      '2. VALOR ESTIMADO: R$ 1.200.000,00 (um milhão e duzentos mil reais).',
      '3. ABERTURA DAS PROPOSTAS: 02/06/2026 às 10h, via sistema Comprasnet.',
      '4. HABILITAÇÃO FISCAL: Certidão Negativa de Débitos Trabalhistas (CNDT) e CND federal.',
      '5. HABILITAÇÃO TÉCNICA: alvará de funcionamento da ANVISA e licença sanitária vigente.',
    ].join('\n'),
    temTextoSelecionavel: true,
    anexos: [],
    paginas: 4,
  },
];

function carregarDataset(caminho: string | undefined): EntradaExtracaoDTO[] {
  if (caminho === undefined) return DATASET_EXEMPLO;
  const raw: unknown = JSON.parse(readFileSync(caminho, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${caminho} não é um array de EntradaExtracaoDTO`);
  return raw as EntradaExtracaoDTO[];
}

async function main(): Promise<void> {
  const [datasetPath, saidaPathArg] = process.argv.slice(2);
  const saidaPath = saidaPathArg ?? resolve('scripts/fixtures/gold-set-raw-cli.json');
  const dataset = carregarDataset(datasetPath);
  const signal = new AbortController().signal;

  // Composition root: liga o claude CLI como delegate do RECORD.
  const cliClient = new ClaudeCliLlmClient({ modelo: 'claude-haiku-4-5-20251001' });

  const gravado = new Map<string, unknown>();
  const editalPorChave = new Map<string, string>();
  const client = new RecordReplayLlmClient(new Map(), {
    delegate: cliClient,
    onRecord: (chave, saida) => gravado.set(chave, saida),
  });

  console.log(`→ gravando ${dataset.length} edital(is) via claude CLI (Haiku, sem API key)…`);
  let erros = 0;
  for (const entrada of dataset) {
    const req = montarRequisicaoExtracao(entrada);
    editalPorChave.set(chavePorConteudo(req), entrada.editalId);
    try {
      const { input: saidaCrua } = await client.extrairViaFerramenta(req, signal);
      // Sanidade: a saída passa no schema (camada 3)?
      try {
        interpretarSaidaExtracao(saidaCrua, entrada);
        console.log(`✓ ${entrada.editalId}`);
      } catch (err) {
        console.warn(`⚠ ${entrada.editalId}: schema inválido (fixture gravada assim mesmo) — ${String(err)}`);
      }
    } catch (err) {
      console.error(`✗ ${entrada.editalId}: ${String(err)}`);
      erros++;
    }
  }

  if (gravado.size === 0) {
    console.error('Nenhuma fixture gravada — verifique se o claude CLI está autenticado.');
    process.exitCode = 1;
    return;
  }

  const casos = [...gravado].map(([chave, saida]) => ({
    editalId: editalPorChave.get(chave) ?? null,
    chave,
    saida,
  }));
  const arquivo = {
    gravadoEm: new Date().toISOString(),
    fonte: 'claude-cli',
    modelo: 'claude-haiku-4-5-20251001',
    total: casos.length,
    erros,
    casos,
  };
  writeFileSync(saidaPath, `${JSON.stringify(arquivo, null, 2)}\n`, 'utf8');
  console.log(`\n✅ ${casos.length} fixture(s) gravada(s) em ${saidaPath}`);
  if (erros > 0) console.warn(`⚠ ${erros} edital(is) falharam — veja os erros acima.`);
}

main().catch((err) => {
  console.error('gravação via CLI falhou:', err);
  process.exitCode = 1;
});
