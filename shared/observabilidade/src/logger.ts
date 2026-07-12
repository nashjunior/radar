import { correlationIdAtual } from './contexto-correlacao.js';
import { redigirParaLog } from './redacao.js';
import { gerarTraceId } from './trace-context.js';

export type NivelLog = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(evento: string, msg: string, campos?: Record<string, unknown>): void;
  info(evento: string, msg: string, campos?: Record<string, unknown>): void;
  warn(evento: string, msg: string, campos?: Record<string, unknown>): void;
  error(evento: string, msg: string, campos?: Record<string, unknown>): void;
}

export type EscritorDeLog = (linha: string, nivel: NivelLog) => void;

const escritorPadrao: EscritorDeLog = (linha, nivel) => {
  if (nivel === 'warn' || nivel === 'error') {
    console.error(linha);
    return;
  }
  console.log(linha);
};

/**
 * Logger JSON Lines em stdout (A18 §4) — CloudWatch coleta, sem SDK, sem I/O
 * no caminho quente. `contexto` (`'api'` | `'worker:<nome>'`) é fixo por call
 * site; `correlationId` vem do `AsyncLocalStorage` corrente (fallback: um
 * trace novo, para logs fora de qualquer requisição/mensagem, ex. boot).
 * Nenhum use case muda de assinatura por causa disto (A18 §3.3).
 *
 * Invariante não-negociável: o registro inteiro passa por `redigirParaLog`
 * campo a campo, incluindo os que o call site adiciona — é o que evita a
 * classe crítica (docs/05 §9) de vazar a log via um campo novo.
 */
export function criarLogger(contexto: string, escrever: EscritorDeLog = escritorPadrao): Logger {
  function registrar(nivel: NivelLog, evento: string, msg: string, campos?: Record<string, unknown>): void {
    const registro = redigirParaLog({
      ts: new Date().toISOString(),
      nivel,
      correlationId: correlationIdAtual() ?? gerarTraceId(),
      contexto,
      evento,
      msg,
      ...campos,
    });
    escrever(JSON.stringify(registro), nivel);
  }

  return {
    debug: (evento, msg, campos) => registrar('debug', evento, msg, campos),
    info: (evento, msg, campos) => registrar('info', evento, msg, campos),
    warn: (evento, msg, campos) => registrar('warn', evento, msg, campos),
    error: (evento, msg, campos) => registrar('error', evento, msg, campos),
  };
}
