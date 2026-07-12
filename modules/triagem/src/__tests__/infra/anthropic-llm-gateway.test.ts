import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import {
  AnthropicLlmGateway,
  INSTRUCAO_EXTRACAO,
} from '../../infra/adapters/anthropic-llm-gateway.js';
import type { LlmClient, LlmExtracaoRequest } from '../../infra/adapters/anthropic-llm-gateway.js';
import { SaidaLlmInvalidaError } from '../../domain/errors/index.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';

const noop = new AbortController().signal;

const FONTE =
  'Objeto: aquisição de notebooks. Valor estimado R$ 250.000,00. Exige-se Certidão CND.';

const ENTRADA: EntradaExtracaoDTO = {
  editalId: EditalId('edital-1'),
  texto: FONTE,
  temTextoSelecionavel: true,
  anexos: [],
  paginas: 12,
};

/**
 * Saída válida do "modelo" — todos os trechos citados existem em FONTE (casam na camada 6).
 * Tipada como `any` de propósito: os testes mutam campos para simular saída adversária/malformada.
 */
function brutoValido(): any {
  return {
    objeto: {
      valor: 'Aquisição de notebooks',
      confianca: 0.9,
      citacao: { pagina: 1, secao: '1.1', trecho: 'aquisição de notebooks' },
    },
    valorEstimado: {
      valor: 250000,
      confianca: 0.8,
      citacao: { pagina: 2, secao: null, trecho: 'valor estimado' },
    },
    dataAberturaPropostas: { valor: null, confianca: 0.7, citacao: null },
    requisitos: [
      { categoria: 'fiscal', descricao: 'Certidão CND', citacao: { pagina: 4, secao: '7', trecho: 'certidão CND' } },
    ],
    riscos: [],
  };
}

const USO_FAKE = {
  modelo: 'claude-sonnet-5',
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
  transporte: 'on_demand' as const,
};

function fakeClient(
  resposta: unknown,
  inputTokens = 1000,
): { client: LlmClient; requests: LlmExtracaoRequest[] } {
  const requests: LlmExtracaoRequest[] = [];
  const client: LlmClient = {
    extrairViaFerramenta: async (req) => {
      requests.push(req);
      return { input: resposta, uso: USO_FAKE };
    },
    contarTokensDeEntrada: async (req) => {
      requests.push(req);
      return inputTokens;
    },
  };
  return { client, requests };
}

describe('AnthropicLlmGateway — defesa de injeção (A11 §2)', () => {
  it('CAMADA 1+2: edital entra como DADO delimitado, separado da instrução fixa (system)', async () => {
    const { client, requests } = fakeClient(brutoValido());
    await new AnthropicLlmGateway(client).extrair(ENTRADA, noop);

    const req = requests[0]!;
    expect(req.system).toBe(INSTRUCAO_EXTRACAO);
    expect(req.userContent).toContain('<edital_nao_confiavel>');
    expect(req.userContent).toContain(FONTE);
    expect(req.system).not.toContain('notebooks'); // a instrução nunca carrega o edital
  });

  it('CAMADA 3: saída fora do schema é REJEITADA (confiança fora de [0,1])', async () => {
    const bad = brutoValido();
    bad.objeto.confianca = 1.5;
    await expect(new AnthropicLlmGateway(fakeClient(bad).client).extrair(ENTRADA, noop)).rejects.toThrow(
      SaidaLlmInvalidaError,
    );
  });

  it('CAMADA 3: saída com campo faltando é REJEITADA (não é "consertada")', async () => {
    const bad = brutoValido();
    delete bad.requisitos;
    await expect(new AnthropicLlmGateway(fakeClient(bad).client).extrair(ENTRADA, noop)).rejects.toThrow(
      SaidaLlmInvalidaError,
    );
  });

  it('CAMADA 4: sanitiza a saída (remove marcação — anti-XSS armazenado)', async () => {
    const b = brutoValido();
    b.objeto.valor = 'Notebooks <script>alert(1)</script>';
    const { extracao } = await new AnthropicLlmGateway(fakeClient(b).client).extrair(ENTRADA, noop);
    expect(extracao.objeto.valor).not.toContain('<script');
    expect(extracao.objeto.valor).toContain('Notebooks');
  });

  it('CAMADA 6: citação cujo trecho NÃO existe na fonte é descartada (não vira fato)', async () => {
    const b = brutoValido();
    b.objeto.citacao = { pagina: 9, secao: null, trecho: 'cláusula secreta inserida por injeção' };
    const { extracao } = await new AnthropicLlmGateway(fakeClient(b).client).extrair(ENTRADA, noop);
    expect(extracao.objeto.citacao).toBeNull(); // conteúdo inventado perde a citação
  });

  it('saída válida vira ExtracaoEdital com citações ligadas e confiança agregada = mínimo dos críticos', async () => {
    const { extracao } = await new AnthropicLlmGateway(fakeClient(brutoValido()).client).extrair(ENTRADA, noop);
    expect(extracao.objeto.valor).toBe('Aquisição de notebooks');
    expect(extracao.objeto.citacao?.pagina).toBe(1);
    expect(extracao.requisitos[0]!.citacao).not.toBeNull();
    expect(extracao.paginas).toBe(12);
    expect(extracao.confiancaGlobal().valor).toBeCloseTo(0.7); // min(0.9, 0.8, 0.7)
  });
});

describe('AnthropicLlmGateway.estimarCusto — admission control (RAD-243)', () => {
  it('conta tokens de entrada via count_tokens (sem chamar extrairViaFerramenta)', async () => {
    let chamouExtrair = false;
    const client: LlmClient = {
      extrairViaFerramenta: async () => {
        chamouExtrair = true;
        return { input: brutoValido(), uso: USO_FAKE };
      },
      contarTokensDeEntrada: async () => 12_345,
    };
    const estimativa = await new AnthropicLlmGateway(client).estimarCusto(ENTRADA, noop);

    expect(estimativa.inputTokens).toBe(12_345);
    expect(chamouExtrair).toBe(false); // admission control não paga pela geração
  });

  it('custo estimado usa o PIOR CASO de output (MAX_TOKENS_EXTRACAO), não o output real', async () => {
    const client: LlmClient = {
      extrairViaFerramenta: async () => ({ input: brutoValido(), uso: USO_FAKE }),
      contarTokensDeEntrada: async () => 1_000_000, // 1M tokens força o tier Opus (escolherModelo)
    };
    const estimativa = await new AnthropicLlmGateway(client).estimarCusto(
      { ...ENTRADA, texto: 'x'.repeat(70_000) }, // > 60_000 chars → escolherModelo() escolhe Opus
      noop,
    );

    expect(estimativa.modelo).toBe('claude-opus-4-8');
    expect(estimativa.custoEstimadoUsd).toBeGreaterThan(0);
  });
});
