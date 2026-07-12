import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { AnthropicLlmGateway, montarRequisicaoExtracao } from '../../infra/adapters/anthropic-llm-gateway.js';
import type { LlmClient } from '../../infra/adapters/anthropic-llm-gateway.js';
import {
  FixtureDeGoldSetAusenteError,
  RecordReplayLlmClient,
  chavePorConteudo,
} from '../../infra/adapters/record-replay-llm-client.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';

const noop = new AbortController().signal;

const FONTE = 'Objeto: aquisição de notebooks. Valor estimado R$ 250.000,00. Exige-se Certidão CND.';

const ENTRADA: EntradaExtracaoDTO = {
  editalId: EditalId('edital-1'),
  texto: FONTE,
  temTextoSelecionavel: true,
  anexos: [],
  paginas: 12,
};

/** Saída crua "gravada" — trechos citados existem em FONTE (casam na camada 6). */
function brutoGravado(): unknown {
  return {
    objeto: {
      valor: 'Aquisição de notebooks',
      confianca: 0.9,
      citacao: { pagina: 1, secao: '1.1', trecho: 'aquisição de notebooks' },
    },
    valorEstimado: { valor: 250000, confianca: 0.8, citacao: { pagina: 2, secao: null, trecho: 'valor estimado' } },
    dataAberturaPropostas: { valor: null, confianca: 0.7, citacao: null },
    requisitos: [
      { categoria: 'fiscal', descricao: 'Certidão CND', citacao: { pagina: 4, secao: '7', trecho: 'certidão CND' } },
    ],
    riscos: [],
  };
}

/** Chave default = o `userContent` da requisição montada para a entrada. */
function chaveDe(entrada: EntradaExtracaoDTO): string {
  return chavePorConteudo(montarRequisicaoExtracao(entrada));
}

describe('RecordReplayLlmClient — seam do gold set (A17 §7 / A16)', () => {
  it('REPLAY: roda o pipeline REAL (camadas 1–6) contra a fixture, sem rede/credencial', async () => {
    const fixtures = new Map<string, unknown>([[chaveDe(ENTRADA), brutoGravado()]]);
    const client = new RecordReplayLlmClient(fixtures);

    const { extracao } = await new AnthropicLlmGateway(client).extrair(ENTRADA, noop);

    // O agregado saiu da fixture PELO pipeline determinístico (bind de citação, sanitização, confiança).
    expect(extracao.objeto.valor).toBe('Aquisição de notebooks');
    expect(extracao.objeto.citacao?.pagina).toBe(1);
    expect(extracao.requisitos[0]!.citacao).not.toBeNull();
    expect(extracao.confiancaGlobal().valor).toBeCloseTo(0.7); // min(0.9, 0.8)
  });

  it('REPLAY sem fixture e sem delegate → FixtureDeGoldSetAusenteError (erro de harness, não runtime)', async () => {
    const client = new RecordReplayLlmClient(new Map());
    await expect(client.extrairViaFerramenta(montarRequisicaoExtracao(ENTRADA), noop)).rejects.toBeInstanceOf(
      FixtureDeGoldSetAusenteError,
    );
  });

  it('RECORD: cache-miss chama o delegate real UMA vez, entrega a captura a onRecord e devolve', async () => {
    const bruto = brutoGravado();
    const usoDelegate = {
      modelo: 'claude-sonnet-5',
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      transporte: 'on_demand' as const,
    };
    const extrair = vi.fn().mockResolvedValue({ input: bruto, uso: usoDelegate });
    const delegate: LlmClient = { extrairViaFerramenta: extrair, contarTokensDeEntrada: vi.fn() };
    const gravado = new Map<string, unknown>();

    const client = new RecordReplayLlmClient(new Map(), {
      delegate,
      onRecord: (chave, saida) => gravado.set(chave, saida),
    });

    const req = montarRequisicaoExtracao(ENTRADA);
    const resultado = await client.extrairViaFerramenta(req, noop);

    expect(extrair).toHaveBeenCalledOnce();
    expect(resultado.input).toBe(bruto);
    expect(resultado.uso).toBe(usoDelegate); // RAD-230: `uso` do delegate real passa direto
    expect(gravado.get(chaveDe(ENTRADA))).toBe(bruto); // fixture materializada p/ replays futuros — só o INPUT
  });

  it('REPLAY tem prioridade sobre o delegate: fixture presente NÃO chama o LLM real (custo zero)', async () => {
    const extrair = vi.fn();
    const delegate: LlmClient = { extrairViaFerramenta: extrair, contarTokensDeEntrada: vi.fn() };
    const fixtures = new Map<string, unknown>([[chaveDe(ENTRADA), brutoGravado()]]);

    const client = new RecordReplayLlmClient(fixtures, { delegate });
    await client.extrairViaFerramenta(montarRequisicaoExtracao(ENTRADA), noop);

    expect(extrair).not.toHaveBeenCalled();
  });

  it('chave injetável: o harness pode indexar o dataset por outra chave (ex.: id do caso)', async () => {
    const fixtures = new Map<string, unknown>([['caso-42', brutoGravado()]]);
    const client = new RecordReplayLlmClient(fixtures, { chave: () => 'caso-42' });

    const { extracao } = await new AnthropicLlmGateway(client).extrair(ENTRADA, noop);
    expect(extracao.objeto.valor).toBe('Aquisição de notebooks');
  });

  it('REPLAY: `uso` é zero (custo real é zero — não chamou o provedor, RAD-230)', async () => {
    const fixtures = new Map<string, unknown>([[chaveDe(ENTRADA), brutoGravado()]]);
    const client = new RecordReplayLlmClient(fixtures);

    const { uso } = await new AnthropicLlmGateway(client).extrair(ENTRADA, noop);
    expect(uso).toEqual({
      modelo: 'replay',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      transporte: 'on_demand',
    });
  });

  it('contarTokensDeEntrada (RAD-243): REPLAY (sem delegate) devolve 0 — nunca rejeita fixture por admission control', async () => {
    const client = new RecordReplayLlmClient(new Map());
    const tokens = await client.contarTokensDeEntrada(montarRequisicaoExtracao(ENTRADA), noop);
    expect(tokens).toBe(0);
  });

  it('contarTokensDeEntrada (RAD-243): RECORD (com delegate) repassa ao client real', async () => {
    const contarTokensDeEntrada = vi.fn().mockResolvedValue(42);
    const delegate: LlmClient = { extrairViaFerramenta: vi.fn(), contarTokensDeEntrada };
    const client = new RecordReplayLlmClient(new Map(), { delegate });

    const tokens = await client.contarTokensDeEntrada(montarRequisicaoExtracao(ENTRADA), noop);

    expect(tokens).toBe(42);
    expect(contarTokensDeEntrada).toHaveBeenCalledOnce();
  });
});
