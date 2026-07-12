/**
 * Guard de tamanho (RAD-310) dos dois contratos que trafegam na fila — `edital.ingerido` e
 * `triagem.solicitada` (A03 §3). O teto real é o hard cap do SQS em
 * `infra/terraform/modules/queue/main.tf:37` (`max_message_size = 262144`, 256 KB); este teste
 * serializa o PIOR CASO de cada contrato exatamente como o publisher serializaria
 * (`JSON.stringify`, envelope `{ type, occurredAt, payload }` — ver
 * `modules/ingestao/src/infra/adapters/sqs-event-publisher.ts`) e assere que fica abaixo do cap.
 * Quem amanhã pendurar conteúdo (texto, anexo, base64) em qualquer um dos dois payloads bate
 * neste teste — a correção é claim-check (chave no S3), nunca o blob.
 */
import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { EditalIngerido, OBJETO_MAX_CHARS } from '@radar/ingestao';
import type { TriagemSolicitadaMsg } from '@radar/triagem/infra';

/** Teto duro do SQS — infra/terraform/modules/queue/main.tf:37 (`max_message_size = 262144`). */
const CAP_SQS_BYTES = 262_144;

describe('RAD-310 — payload de fila sob o cap do SQS', () => {
  it('edital.ingerido: objeto no teto de OBJETO_MAX_CHARS (truncagem já aplicada) fica < 256 KB', () => {
    const evento = new EditalIngerido({
      editalId: EditalId('11111111-1111-4111-8111-111111111111'),
      numeroControlePncp: '99999999000199-1-999999/9999',
      modalidadeCodigo: 8,
      faseAtual: 'PUBLICADO',
      dataAtualizacao: new Date('2026-07-12T12:00:00.000Z'),
      // Pior caso pós-guard (RAD-310): objeto já truncado no limite — este teste garante que o
      // ENVELOPE inteiro, com objeto no teto, ainda cabe folgado no cap do SQS.
      objeto: 'x'.repeat(OBJETO_MAX_CHARS),
      orgaoUf: 'SP',
      valorEstimado: 999_999_999.99,
      dataPublicacao: new Date('2026-07-01T00:00:00.000Z'),
      proveniencia: {
        fonte: 'PNCP — Consulta Pública, art. 174 Lei 14.133/2021',
        baseLegal: 'Lei 14.133/2021, art. 174 c/c LAI (Lei 12.527/2011)',
        dataColeta: '2026-07-12T12:00:00.000Z',
      },
    });

    // Mesmo envelope do adapter real (comentado até a fila ser provisionada, P-96 §4).
    const body = JSON.stringify({
      type: evento.type,
      occurredAt: evento.occurredAt.toISOString(),
      payload: evento.payload,
    });

    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(CAP_SQS_BYTES);
  });

  it('triagem.solicitada: todos os campos (incl. opcional solicitadaEm) preenchidos fica < 256 KB', () => {
    const msg: TriagemSolicitadaMsg = {
      tenantId: '22222222-2222-4222-8222-222222222222',
      usuarioId: '33333333-3333-4333-8333-333333333333',
      editalId: '11111111-1111-4111-8111-111111111111',
      perfilId: '44444444-4444-4444-8444-444444444444',
      coorteTrial: true,
      solicitadaEm: '2026-07-12T12:00:00.000Z',
    };

    const body = JSON.stringify(msg);

    expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(CAP_SQS_BYTES);
  });
});
