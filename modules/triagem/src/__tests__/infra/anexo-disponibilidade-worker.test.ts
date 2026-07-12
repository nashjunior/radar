import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { AnexoDisponibilidadeWorker } from '../../infra/queue/anexo-disponibilidade-worker.js';
import type { ReenfileirarTriagensPendentesUseCase } from '../../application/use-cases/reenfileirar-triagens-pendentes.js';

const signal = new AbortController().signal;

describe('AnexoDisponibilidadeWorker (P-110/RAD-281)', () => {
  it('traduz a mensagem de anexo.aprovado/anexo.rejeitado para o input do use case', async () => {
    const executar = vi.fn().mockResolvedValue(undefined);
    const reenfileirar = { executar } as unknown as ReenfileirarTriagensPendentesUseCase;
    const worker = new AnexoDisponibilidadeWorker(reenfileirar);

    await worker.processar({ editalId: 'edital-1', restamPendentes: true }, signal);

    expect(executar).toHaveBeenCalledExactlyOnceWith(
      { editalId: EditalId('edital-1'), restamAnexosPendentes: true },
      signal,
    );
  });
});
