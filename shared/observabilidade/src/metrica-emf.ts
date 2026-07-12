import { redigirParaLog } from './redacao.js';

export type UnidadeMetricaEmf = 'Milliseconds' | 'Count' | 'None';

export interface MetricaEmf {
  readonly nome: string;
  readonly valor: number;
  readonly unidade: UnidadeMetricaEmf;
}

export interface EmitirMetricaEmfInput {
  readonly ambiente: string;
  readonly metricas: readonly MetricaEmf[];
  /** Dimensões CloudWatch além de `ambiente` — só valor de baixa cardinalidade (nunca `tenantId`, A18 §5). */
  readonly dimensoes?: Record<string, string>;
  /** Campos extras do LOG (não viram dimensão da métrica) — ex.: `tenantId`, rastreável mas não agregável. */
  readonly campos?: Record<string, unknown>;
}

export type EscritorDeMetrica = (linha: string) => void;

const escritorPadrao: EscritorDeMetrica = (linha) => console.log(linha);

const NAMESPACE = 'Radar/SLO';

/**
 * Emite métrica(s) em CloudWatch EMF (A18 §5) — JSON Lines em stdout; o CloudWatch extrai a
 * métrica de qualquer log event no formato `_aws.CloudWatchMetrics`, sem `PutMetricData` no
 * caminho quente (sem latência, sem throttling, sem IAM novo). Namespace e nome de dimensão
 * são o contrato fixo que os alarmes de RAD-304 leem — não são knobs de call site.
 *
 * `dimensoes`/`campos` passam por `redigirParaLog` (A18 §4) — só o bloco `_aws` e os
 * nomes/valores de métrica em si (controlados pelo emissor, não por dado externo) ficam de fora,
 * porque a redação recursiva tem um teto de profundidade que corromperia a estrutura fixa do EMF.
 */
export function emitirMetricaEmf(input: EmitirMetricaEmfInput, escrever: EscritorDeMetrica = escritorPadrao): void {
  const nomesDimensao = ['ambiente', ...Object.keys(input.dimensoes ?? {})];

  const registro: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [nomesDimensao],
          Metrics: input.metricas.map((m) => ({ Name: m.nome, Unit: m.unidade })),
        },
      ],
    },
    ambiente: input.ambiente,
    ...(redigirParaLog(input.dimensoes ?? {}) as Record<string, unknown>),
    ...(redigirParaLog(input.campos ?? {}) as Record<string, unknown>),
  };

  for (const m of input.metricas) {
    registro[m.nome] = m.valor;
  }

  escrever(JSON.stringify(registro));
}
