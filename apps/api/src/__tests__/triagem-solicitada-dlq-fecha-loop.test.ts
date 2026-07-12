/**
 * Integração RAD-259 (fecha o pré-requisito de RAD-257, P-107 (c) ponta a ponta):
 * uma mensagem de `triagem.solicitada` que esgota os retries de INFRA — crash antes de
 * `TriarEditalUseCase.executar` chegar a rodar, ex. hidratação (`DocumentosEditalGateway`)
 * indisponível — cai no handler de DLQ DEDICADO do `TriagemSolicitadaWorker` (RAD-259), que
 * publica `triagem.falhou` com a chave natural da mensagem original. O `CobrancaWorker`
 * (RAD-247) consome esse evento e libera a reserva de cota feita por `SolicitarTriagemUseCase`
 * — sem isso a cota vaza (docs/13 §3).
 *
 * Sem fila real (SQS, P-96 §4) provisionada, a "entrega" do evento entre os dois módulos é
 * roteada aqui por uma ponte de teste — o mesmo papel que o event bus fará quando existir.
 * Isolamento de bounded context preservado: nenhum módulo importa `infra/` do outro.
 */
import { describe, expect, it, vi } from 'vitest';
import { TenantId } from '@radar/kernel';
import { TriagemSolicitadaWorker } from '@radar/triagem/infra';
import type { TriagemSolicitadaMsg } from '@radar/triagem/infra';
import type {
  DocumentosEditalGateway,
  EventPublisher,
  ObjectStorage,
  TriarEditalUseCase,
} from '@radar/triagem';
import { CobrancaWorker } from '@radar/cobranca/infra';
import { ConfirmarUsoUseCase, LiberarReservaUseCase } from '@radar/cobranca';
import type { AssinaturaRepository } from '@radar/cobranca';

const signal = new AbortController().signal;

const MSG: TriagemSolicitadaMsg = {
  tenantId: 'tenant-259',
  usuarioId: 'cliente-259',
  editalId: 'edital-259',
  perfilId: 'perfil-259',
};

describe('RAD-259 — DLQ de triagem.solicitada fecha o loop com CobrancaWorker (RAD-255→RAD-247)', () => {
  it('retries de infra esgotados → processarDlq publica triagem.falhou → CobrancaWorker libera a reserva do tenant certo', async () => {
    // TriarEditalUseCase nunca deve rodar neste caminho — a falha é ANTES dele (hidratação).
    const triarEditalUC = { executar: vi.fn() } as unknown as TriarEditalUseCase;

    const erroDeInfra = new Error('DocumentosEditalGateway indisponível (crash antes de executar())');
    const documentosGateway: DocumentosEditalGateway = {
      obterRefs: vi.fn().mockRejectedValue(erroDeInfra),
    };
    const storage: ObjectStorage = { obterTextoAnexo: vi.fn() };

    const assinaturas: AssinaturaRepository = {
      porTenantId: vi.fn().mockResolvedValue(null),
      porAssinaturaExternaId: vi.fn().mockResolvedValue(null),
      salvar: vi.fn().mockResolvedValue(undefined),
      reservarCota: vi.fn().mockResolvedValue(true),
      liberarReserva: vi.fn().mockResolvedValue(undefined),
      confirmarUso: vi.fn().mockResolvedValue(undefined),
    };
    const liberarReservaUC = new LiberarReservaUseCase(assinaturas);
    const confirmarUsoUC = { executar: vi.fn() } as unknown as ConfirmarUsoUseCase;
    const dlqCobranca = { encaminhar: vi.fn().mockResolvedValue(undefined) };
    const cobrancaWorker = new CobrancaWorker(confirmarUsoUC, liberarReservaUC, dlqCobranca);

    // Ponte de teste: rotea `triagem.falhou` publicado pela Triagem para o consumidor da Cobrança
    // — o papel que o event bus (SQS) cumprirá quando provisionado (P-96 §4).
    const eventosTriagem: EventPublisher = {
      async publicar(evento, sig) {
        if (evento.type === 'triagem.falhou') {
          const falhou = evento as unknown as {
            payload: { tenantId: string };
          };
          await cobrancaWorker.processarTriagemFalhou({ tenantId: falhou.payload.tenantId }, sig);
        }
      },
    };

    const dlqTriagem = { encaminhar: vi.fn().mockResolvedValue(undefined) };
    const worker = new TriagemSolicitadaWorker(triarEditalUC, documentosGateway, storage, eventosTriagem, dlqTriagem);

    // 1. Consome a mensagem — a hidratação falha (infra) e propaga (NACK simulado).
    await expect(worker.processar(MSG, signal)).rejects.toThrow(erroDeInfra.message);
    expect(triarEditalUC.executar).not.toHaveBeenCalled();

    // 2. Transporte esgota os retries — aciona o handler de DLQ dedicado com a MESMA mensagem.
    await worker.processarDlq(MSG, erroDeInfra, signal);

    // 3. triagem.falhou chegou à Cobrança e liberou a reserva do tenant original — loop fechado.
    expect(assinaturas.liberarReserva).toHaveBeenCalledExactlyOnceWith(TenantId(MSG.tenantId), signal);
    expect(dlqTriagem.encaminhar).toHaveBeenCalledExactlyOnceWith(MSG, erroDeInfra);
  });
});
