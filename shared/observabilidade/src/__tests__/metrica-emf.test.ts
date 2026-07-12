import { describe, expect, it } from 'vitest';
import { emitirMetricaEmf } from '../metrica-emf.js';

function capturar() {
  const linhas: string[] = [];
  return { linhas, escrever: (linha: string) => linhas.push(linha) };
}

describe('emitirMetricaEmf (A18 §5)', () => {
  it('emite um bloco _aws.CloudWatchMetrics com namespace Radar/SLO e dimensão ambiente', () => {
    const { linhas, escrever } = capturar();

    emitirMetricaEmf(
      { ambiente: 'prod', metricas: [{ nome: 'alerta.frescor_ms', valor: 1234, unidade: 'Milliseconds' }] },
      escrever,
    );

    expect(linhas).toHaveLength(1);
    const registro = JSON.parse(linhas[0]!);
    expect(registro._aws.CloudWatchMetrics).toEqual([
      {
        Namespace: 'Radar/SLO',
        Dimensions: [['ambiente']],
        Metrics: [{ Name: 'alerta.frescor_ms', Unit: 'Milliseconds' }],
      },
    ]);
    expect(registro.ambiente).toBe('prod');
    expect(registro['alerta.frescor_ms']).toBe(1234);
    expect(typeof registro._aws.Timestamp).toBe('number');
  });

  it('inclui dimensões extras no nome E no valor do registro (ex.: imediato)', () => {
    const { linhas, escrever } = capturar();

    emitirMetricaEmf(
      {
        ambiente: 'staging',
        metricas: [{ nome: 'notificacao.latencia_entrega_ms', valor: 500, unidade: 'Milliseconds' }],
        dimensoes: { imediato: 'true' },
      },
      escrever,
    );

    const registro = JSON.parse(linhas[0]!);
    expect(registro._aws.CloudWatchMetrics[0].Dimensions).toEqual([['ambiente', 'imediato']]);
    expect(registro.imediato).toBe('true');
  });

  it('suporta múltiplas métricas no mesmo registro (mesmas dimensões)', () => {
    const { linhas, escrever } = capturar();

    emitirMetricaEmf(
      {
        ambiente: 'dev',
        metricas: [
          { nome: 'pipeline.ciclo.ok', valor: 1, unidade: 'Count' },
          { nome: 'pipeline.ciclo.erro', valor: 0, unidade: 'Count' },
        ],
      },
      escrever,
    );

    const registro = JSON.parse(linhas[0]!);
    expect(registro['pipeline.ciclo.ok']).toBe(1);
    expect(registro['pipeline.ciclo.erro']).toBe(0);
    expect(registro._aws.CloudWatchMetrics[0].Metrics).toEqual([
      { Name: 'pipeline.ciclo.ok', Unit: 'Count' },
      { Name: 'pipeline.ciclo.erro', Unit: 'Count' },
    ]);
  });

  it('nunca usa tenantId como dimensão — só como campo do registro (A18 §5)', () => {
    const { linhas, escrever } = capturar();

    emitirMetricaEmf(
      {
        ambiente: 'prod',
        metricas: [{ nome: 'triagem.latencia_ms', valor: 100, unidade: 'Milliseconds' }],
        campos: { tenantId: 'tenant-001' },
      },
      escrever,
    );

    const registro = JSON.parse(linhas[0]!);
    expect(registro.tenantId).toBe('tenant-001');
    const nomesDimensao = registro._aws.CloudWatchMetrics[0].Dimensions[0] as string[];
    expect(nomesDimensao).not.toContain('tenantId');
  });

  it('redige campo sensível em `campos` (email, CPF etc.) antes de emitir', () => {
    const { linhas, escrever } = capturar();

    emitirMetricaEmf(
      {
        ambiente: 'prod',
        metricas: [{ nome: 'triagem.latencia_ms', valor: 100, unidade: 'Milliseconds' }],
        campos: { contato: 'fulano@empresa.com' },
      },
      escrever,
    );

    const registro = JSON.parse(linhas[0]!);
    expect(registro.contato).toBe('[REDACTED]');
  });

  it('redige valor sensível em `dimensoes` também — a mesma garantia de `campos`', () => {
    const { linhas, escrever } = capturar();

    emitirMetricaEmf(
      {
        ambiente: 'prod',
        metricas: [{ nome: 'triagem.latencia_ms', valor: 100, unidade: 'Milliseconds' }],
        dimensoes: { canal: 'fulano@empresa.com' },
      },
      escrever,
    );

    const registro = JSON.parse(linhas[0]!);
    expect(registro.canal).toBe('[REDACTED]');
    // o NOME da dimensão (chave) continua vindo do dimensoes original — redigirParaLog não renomeia chaves.
    expect(registro._aws.CloudWatchMetrics[0].Dimensions).toEqual([['ambiente', 'canal']]);
  });

  it('a estrutura _aws.CloudWatchMetrics não é corrompida pela redação (teto de profundidade)', () => {
    const { linhas, escrever } = capturar();

    emitirMetricaEmf(
      {
        ambiente: 'prod',
        dimensoes: { imediato: 'true' },
        metricas: [{ nome: 'notificacao.latencia_entrega_ms', valor: 1, unidade: 'Milliseconds' }],
      },
      escrever,
    );

    const registro = JSON.parse(linhas[0]!);
    // Dimensions é um array de array de string — se a redação tivesse sido aplicada ao _aws
    // inteiro, o teto de profundidade (4 níveis) teria substituído isso por '[Objeto]'.
    expect(Array.isArray(registro._aws.CloudWatchMetrics[0].Dimensions[0])).toBe(true);
  });

  it('usa console.log como escritor padrão quando nenhum é injetado', () => {
    const chamadas: string[] = [];
    const original = console.log;
    console.log = (linha: string) => chamadas.push(linha);
    try {
      emitirMetricaEmf({ ambiente: 'prod', metricas: [{ nome: 'triagem.latencia_ms', valor: 1, unidade: 'Milliseconds' }] });
    } finally {
      console.log = original;
    }
    expect(chamadas).toHaveLength(1);
    expect(() => JSON.parse(chamadas[0]!)).not.toThrow();
  });
});
