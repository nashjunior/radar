/**
 * Config mínima do agendador: cadência e tratamento de falha.
 * Parâmetros específicos de cada scheduler (janela, destinatários, modalidades...)
 * ficam na `Config` local de cada módulo — aqui só o que o loop abortável precisa.
 */
export interface AgendadorAbortavelConfig {
  /** Intervalo entre ciclos em ms. */
  intervaloMs: number;
  aoFalhar?: ((erro: unknown) => void) | undefined;
}

/**
 * Roda `executarCiclo` uma vez imediatamente e depois a cada `config.intervaloMs`,
 * até que `signal` aborte. Erros de um ciclo são capturados via `config.aoFalhar`
 * (nunca derrubam o `setInterval`).
 *
 * Guarda dupla contra vazamento do `setInterval` (RAD-195): não inicia se `signal`
 * já estiver abortado, e registra um listener de `abort` que autolimpa o timer
 * mesmo que o caller nunca invoque a função de teardown retornada.
 */
export function iniciarAgendadorAbortavel<T>(
  executarCiclo: (signal: AbortSignal) => Promise<T>,
  config: AgendadorAbortavelConfig,
  signal: AbortSignal,
): () => void {
  const executar = (): void => {
    if (signal.aborted) return;
    void executarCiclo(signal).catch((erro: unknown) => {
      if (!signal.aborted) config.aoFalhar?.(erro);
    });
  };

  if (signal.aborted) return () => {};

  executar();
  const handle = setInterval(executar, config.intervaloMs);
  const limpar = (): void => {
    clearInterval(handle);
    signal.removeEventListener('abort', limpar);
  };
  signal.addEventListener('abort', limpar, { once: true });
  return limpar;
}
