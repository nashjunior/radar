/**
 * RAD-320 — `PncpPollingScheduler`/`CircuitBreaker` compostos em `apps/api`, gated por
 * `INGESTAO_SCHEDULER_ENABLED` (default OFF, docs/98 P-113 (5)): ligar o gate dispara
 * `.iniciar()` de imediato (kernel `iniciarAgendadorAbortavel`), que bate na PNCP real —
 * por isso só o gate é exercitado aqui. A composição com o gate ligado só é verificada
 * com LocalStack + `tools/pncp-mock` (nunca a PNCP real), conforme a issue.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { iniciarSchedulerIngestao } from '../scheduler.js';

afterEach(() => {
  delete process.env['INGESTAO_SCHEDULER_ENABLED'];
});

describe('iniciarSchedulerIngestao', () => {
  it('retorna null quando INGESTAO_SCHEDULER_ENABLED está ausente — default OFF', () => {
    expect(iniciarSchedulerIngestao()).toBeNull();
  });

  it('retorna null para qualquer valor diferente de "true" — fail-closed', () => {
    process.env['INGESTAO_SCHEDULER_ENABLED'] = 'false';
    expect(iniciarSchedulerIngestao()).toBeNull();

    process.env['INGESTAO_SCHEDULER_ENABLED'] = '1';
    expect(iniciarSchedulerIngestao()).toBeNull();
  });
});
