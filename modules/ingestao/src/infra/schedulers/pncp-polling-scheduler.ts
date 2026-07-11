import { iniciarAgendadorAbortavel } from '@radar/kernel';
import type { IngerirAtualizacoesUseCase } from '../../application/use-cases/ingerir-atualizacoes.js';
import type { IngerirEditaisUseCase } from '../../application/use-cases/ingerir-editais.js';
import { PipelineCicloConcluido } from '../../application/events.js';
import type { IngestaoResumoDTO } from '../../application/dtos.js';
import type { EventPublisher } from '../../application/ports.js';
import { BreakerAbertoError } from '../../domain/errors/index.js';

// ---------------------------------------------------------------------------
// Cadência de polling — P-29 (arq/02 §3 · docs/12 §3)
// ---------------------------------------------------------------------------
// Volume PNCP medido (P-31): ~6.000 novas contratações/dia + ~15.000 atualizações.
// Pico estimado: 2–3× = 1.000–1.500/hora.
//
// Estratégia para p95 frescor ≤ 30 min:
//   • Regime publicacao  — intervaloMs: 5 min, tamanhoJanelaMs: 35 min,
//                          modalidades MVP: [6, 8, 9] (≥ 90 % do volume).
//   • Regime atualizacao — intervaloMs: 5 min, tamanhoJanelaMs: 35 min,
//                          sem filtro de modalidade (endpoint /atualizacao cobre tudo).
//   • Reconciliação diária — intervalo: 24 h, janela ampla, todas as modalidades.
//
// Consumo de requests por ciclo:
//   • 3 modalidades × ~2 páginas (tamanhoPagina=50) = ~6 req/5 min para publicacao.
//   • ~5–10 páginas para atualizacao = ~10 req/5 min.
//   Total: ~16 req/5 min → ~192 req/hora — bem abaixo do rate-limit educado (arq/02 §5).
//
// Esses valores NÃO estão hard-coded aqui: são injetados via PncpPollingSchedulerConfig
// para permitir ajuste fino em produção (números confirmam no ar — P-29 resolvido).

/**
 * Regime de polling:
 * - `publicacao`: busca novos editais via `/publicacao` por modalidade.
 * - `atualizacao`: busca mudanças via `/atualizacao` (todas as modalidades).
 */
export type RegimePolling = 'publicacao' | 'atualizacao';

export interface PncpPollingSchedulerConfig {
  /** Modalidades a iterar no regime `publicacao`. Ignorado no regime `atualizacao`. */
  modalidades: readonly number[];
  /** Intervalo entre ciclos em ms. Padrão recomendado: 5 min (300_000). */
  intervaloMs: number;
  /** Tamanho da janela temporal por ciclo em ms. Padrão recomendado: 35 min (2_100_000). */
  tamanhoJanelaMs: number;
  /**
   * Regime de polling (P-29).
   * `publicacao` = novos editais por modalidade (default).
   * `atualizacao` = mudanças de fase/prazo cross-modalidade.
   */
  regime?: RegimePolling;
  agora?: () => Date;
  aoFalhar?: (erro: unknown) => void;
}

type UseCasePub = Pick<IngerirEditaisUseCase, 'executar'>;
type UseCaseAtl = Pick<IngerirAtualizacoesUseCase, 'executar'>;

/**
 * Scheduler de polling PNCP para o composition root da Ingestão.
 * Emite `pipeline.ciclo.concluido` (P-15) após cada ciclo para observabilidade.
 * Integra circuit breaker via `BreakerAbertoError`: se o breaker estiver aberto,
 * o ciclo é pulado com degradação graciosa (arq/04 §§6–7).
 */
export class PncpPollingScheduler {
  private readonly regime: RegimePolling;
  private readonly agora: () => Date;

  constructor(
    private readonly ingerirEditais: UseCasePub,
    private readonly config: PncpPollingSchedulerConfig,
    private readonly ingerirAtualizacoes?: UseCaseAtl,
    private readonly eventos?: Pick<EventPublisher, 'publicar'>,
  ) {
    if (config.modalidades.length === 0) {
      throw new RangeError('modalidades não pode ser vazio');
    }
    if (!Number.isFinite(config.intervaloMs) || config.intervaloMs <= 0) {
      throw new RangeError('intervaloMs deve ser > 0 e finito');
    }
    if (!Number.isFinite(config.tamanhoJanelaMs) || config.tamanhoJanelaMs <= 0) {
      throw new RangeError('tamanhoJanelaMs deve ser > 0 e finito');
    }

    this.regime = config.regime ?? 'publicacao';
    this.agora = config.agora ?? (() => new Date());
  }

  async executarCiclo(signal: AbortSignal): Promise<IngestaoResumoDTO[]> {
    const inicioMs = Date.now();
    const fim = this.agora();
    const inicio = new Date(fim.getTime() - this.config.tamanhoJanelaMs);
    const resultados: IngestaoResumoDTO[] = [];
    let breakerAberto = false;

    try {
      if (this.regime === 'atualizacao') {
        if (!this.ingerirAtualizacoes) {
          throw new Error(
            'regime "atualizacao" requer ingerirAtualizacoes no construtor',
          );
        }
        signal.throwIfAborted();
        resultados.push(
          await this.ingerirAtualizacoes.executar({ janela: { inicio, fim } }, signal),
        );
      } else {
        for (const modalidade of this.config.modalidades) {
          signal.throwIfAborted();
          resultados.push(
            await this.ingerirEditais.executar({ modalidade, janela: { inicio, fim } }, signal),
          );
        }
      }
    } catch (err) {
      if (err instanceof BreakerAbertoError) {
        breakerAberto = true;
      } else {
        throw err;
      }
    }

    if (this.eventos && !signal.aborted) {
      const totais = resultados.reduce(
        (acc, r) => ({
          ingeridos: acc.ingeridos + r.ingeridos,
          atualizados: acc.atualizados + r.atualizados,
          erros: acc.erros + r.erros,
        }),
        { ingeridos: 0, atualizados: 0, erros: 0 },
      );

      void this.eventos.publicar(
        new PipelineCicloConcluido({
          regime: this.regime,
          modalidades:
            this.regime === 'publicacao' ? [...this.config.modalidades] : [],
          janela: {
            inicio: inicio.toISOString(),
            fim: fim.toISOString(),
          },
          ...totais,
          duracaoMs: Date.now() - inicioMs,
          breakerAberto,
        }),
        signal,
      );
    }

    return resultados;
  }

  iniciar(signal: AbortSignal): () => void {
    return iniciarAgendadorAbortavel(
      s => this.executarCiclo(s),
      { intervaloMs: this.config.intervaloMs, aoFalhar: this.config.aoFalhar },
      signal,
    );
  }
}
