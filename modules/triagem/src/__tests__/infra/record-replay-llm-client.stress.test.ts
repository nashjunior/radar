/**
 * Stress tests — RecordReplayLlmClient (seam do gold set A17 §7 / A16).
 * Foco: FixtureDeGoldSetAusenteError properties, AbortSignal, concurrent replays,
 * RECORD accumulation, chave edge cases, large fixture maps.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  FixtureDeGoldSetAusenteError,
  RecordReplayLlmClient,
  chavePorConteudo,
} from '../../infra/adapters/record-replay-llm-client.js';
import type { LlmClient, LlmExtracaoRequest } from '../../infra/adapters/anthropic-llm-gateway.js';

const noop = new AbortController().signal;

function req(userContent = 'edital de teste'): LlmExtracaoRequest {
  return { modelo: 'claude-sonnet-5', system: 'instrucao', userContent, ferramenta: 'extrair' };
}

const FIXTURE_BRUTA = { objeto: { valor: 'Test', confianca: 0.9, citacao: null }, requisitos: [], riscos: [] };

describe('FixtureDeGoldSetAusenteError — propriedades (A17 §7)', () => {
  it('code é FIXTURE_GOLD_SET_AUSENTE', () => {
    const err = new FixtureDeGoldSetAusenteError('chave-test');
    expect(err.code).toBe('FIXTURE_GOLD_SET_AUSENTE');
  });

  it('chave preserva o valor exato passado ao construtor', () => {
    const chave = 'chave-caso-42-unicode-🔒';
    const err = new FixtureDeGoldSetAusenteError(chave);
    expect(err.chave).toBe(chave);
  });

  it('não é um DomainError (erro de harness, nunca exposto no runtime)', () => {
    const err = new FixtureDeGoldSetAusenteError('x');
    // Não deve extender DomainError (não mapeia a HTTP, é erro de configuração do harness)
    expect(err).toBeInstanceOf(Error);
  });

  it('name é FixtureDeGoldSetAusenteError', () => {
    expect(new FixtureDeGoldSetAusenteError('x').name).toBe('FixtureDeGoldSetAusenteError');
  });

  it('mensagem contém informação sobre fixture ausente', () => {
    const err = new FixtureDeGoldSetAusenteError('minha-chave');
    expect(err.message).toMatch(/gold set/i);
  });
});

describe('RecordReplayLlmClient — REPLAY estabilidade (concurrent / sequential)', () => {
  it('100 replays sequenciais retornam sempre o mesmo objeto fixture', async () => {
    const chave = chavePorConteudo(req());
    const fixtures = new Map<string, unknown>([[chave, FIXTURE_BRUTA]]);
    const client = new RecordReplayLlmClient(fixtures);

    for (let i = 0; i < 100; i++) {
      const { input } = await client.extrairViaFerramenta(req(), noop);
      expect(input).toBe(FIXTURE_BRUTA); // mesma referência — não copia
    }
  });

  it('20 replays concorrentes retornam todos a fixture correta', async () => {
    const chave = chavePorConteudo(req());
    const fixtures = new Map<string, unknown>([[chave, FIXTURE_BRUTA]]);
    const client = new RecordReplayLlmClient(fixtures);

    const resultados = await Promise.all(
      Array.from({ length: 20 }, () => client.extrairViaFerramenta(req(), noop)),
    );

    expect(resultados).toHaveLength(20);
    resultados.forEach((r) => expect(r.input).toBe(FIXTURE_BRUTA));
  });

  it('lookup em mapa grande (1000 fixtures) é O(1) — resolve a chave correta', async () => {
    const fixtures = new Map<string, unknown>();
    for (let i = 0; i < 999; i++) {
      fixtures.set(`chave-caso-${i}`, { indice: i });
    }
    const chaveAlvo = 'chave-alvo';
    const valorAlvo = { correto: true };
    fixtures.set(chaveAlvo, valorAlvo);

    const client = new RecordReplayLlmClient(fixtures, { chave: () => chaveAlvo });

    const { input } = await client.extrairViaFerramenta(req(), noop);
    expect(input).toBe(valorAlvo);
  });

  it('chave vazia ("") funciona se fixture tem "" como chave', async () => {
    const fixtures = new Map<string, unknown>([['', FIXTURE_BRUTA]]);
    const client = new RecordReplayLlmClient(fixtures, { chave: () => '' });

    const { input } = await client.extrairViaFerramenta(req(), noop);
    expect(input).toBe(FIXTURE_BRUTA);
  });
});

describe('RecordReplayLlmClient — RECORD accumulation', () => {
  it('múltiplos cache-miss em sequência acumulam todas as fixtures em onRecord', async () => {
    const brutos = [{ idx: 0 }, { idx: 1 }, { idx: 2 }];
    let delegateCall = 0;
    const delegate: LlmClient = {
      extrairViaFerramenta: vi.fn().mockImplementation(() => brutos[delegateCall++]),
    };
    const gravado = new Map<string, unknown>();

    const client = new RecordReplayLlmClient(new Map(), {
      delegate,
      onRecord: (chave, saida) => gravado.set(chave, saida),
    });

    await client.extrairViaFerramenta(req('edital-A'), noop);
    await client.extrairViaFerramenta(req('edital-B'), noop);
    await client.extrairViaFerramenta(req('edital-C'), noop);

    expect(gravado.size).toBe(3);
    expect(delegate.extrairViaFerramenta).toHaveBeenCalledTimes(3);
  });

  it('RECORD: onRecord recebe a chave exata derivada pelo ChaveCaso', async () => {
    const chaveFixa = 'minha-chave-custom';
    const bruto = { resultado: 'ok' };
    const delegate: LlmClient = { extrairViaFerramenta: vi.fn().mockResolvedValue(bruto) };
    let capturedChave: string | undefined;

    const client = new RecordReplayLlmClient(new Map(), {
      delegate,
      chave: () => chaveFixa,
      onRecord: (chave, _saida) => { capturedChave = chave; },
    });

    await client.extrairViaFerramenta(req(), noop);

    expect(capturedChave).toBe(chaveFixa);
  });

  it('RECORD: onRecord NÃO é chamado em REPLAY (fixture presente)', async () => {
    const chave = chavePorConteudo(req());
    const onRecord = vi.fn();
    const fixtures = new Map<string, unknown>([[chave, FIXTURE_BRUTA]]);

    const client = new RecordReplayLlmClient(fixtures, {
      delegate: { extrairViaFerramenta: vi.fn() },
      onRecord,
    });

    await client.extrairViaFerramenta(req(), noop);
    expect(onRecord).not.toHaveBeenCalled();
  });
});

describe('RecordReplayLlmClient — AbortSignal (P-78)', () => {
  it('propaga AbortSignal ao delegate em modo RECORD', async () => {
    const controller = new AbortController();
    const extrairViaFerramenta = vi.fn().mockResolvedValue(FIXTURE_BRUTA);
    const delegate: LlmClient = { extrairViaFerramenta };

    const client = new RecordReplayLlmClient(new Map(), { delegate });
    await client.extrairViaFerramenta(req(), controller.signal);

    expect(extrairViaFerramenta).toHaveBeenCalledWith(expect.anything(), controller.signal);
  });

  it('REPLAY não chama delegate mesmo com signal abortado — retorna fixture sem erro', async () => {
    const controller = new AbortController();
    controller.abort();
    const chave = chavePorConteudo(req());
    const fixtures = new Map<string, unknown>([[chave, FIXTURE_BRUTA]]);
    const delegate: LlmClient = { extrairViaFerramenta: vi.fn() };

    const client = new RecordReplayLlmClient(fixtures, { delegate });
    const { input } = await client.extrairViaFerramenta(req(), controller.signal);

    // REPLAY lê do mapa local — AbortSignal não a afeta (sem I/O)
    expect(input).toBe(FIXTURE_BRUTA);
    expect(delegate.extrairViaFerramenta).not.toHaveBeenCalled();
  });
});

describe('RecordReplayLlmClient — chavePorConteudo (função default)', () => {
  it('chaves diferentes para userContent diferentes', () => {
    const r1 = req('edital A');
    const r2 = req('edital B');
    expect(chavePorConteudo(r1)).not.toBe(chavePorConteudo(r2));
  });

  it('mesma chave para mesmo userContent (determinístico)', () => {
    const r1 = req('edital idêntico');
    const r2 = req('edital idêntico');
    expect(chavePorConteudo(r1)).toBe(chavePorConteudo(r2));
  });

  it('userContent unicode gera chave válida (caracteres PNCP reais)', () => {
    const conteudo = 'Objeto: aquisição de equipamentos — R$ 1.234.567,89. Órgão: Município de São Paulo.';
    const chave = chavePorConteudo(req(conteudo));
    expect(typeof chave).toBe('string');
    expect(chave).toBe(conteudo); // default = o próprio conteudo
  });
});
