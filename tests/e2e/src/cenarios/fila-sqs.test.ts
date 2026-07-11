/**
 * CE-SQS-01..03 — Semântica de fila real (LocalStack SQS)
 *
 * Suíte separada e opt-in: cobre o que o InMemoryEventBus síncrono não exercita —
 * redelivery real via visibility timeout, DLQ por esgotamento de tentativas (P-41)
 * e ACK seletivo em processamento parcialmente falho de batch.
 *
 * Docker-gated: pula automaticamente quando Docker não está disponível
 * (mesma postura dos Testcontainers de pipeline-alerta.test.ts — RAD-130).
 * NÃO converte nem substitui CE-01..CE-05.
 *
 * A04 §4 — ambiente isolado: sem PNCP/LLM/SES/SQS reais; LocalStack é o dublê.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  type Message,
  ReceiveMessageCommand,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { AlertaId, ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { NotificarAlertaUseCase, UsuarioId } from '@radar/notificacao';
import {
  NotificacaoWorker,
  PostgresNotificacaoRepository,
  PostgresPreferenciaRepository,
} from '@radar/notificacao/infra';
import { startDb, teardownDb, type DbFixture } from '../helpers/db.js';
import {
  criarFilaComDlq,
  startLocalstackSqs,
  teardownLocalstack,
  type SqsFixture,
} from '../helpers/localstack.js';
import { CaptureNotifier } from '../stubs/capture-notifier.js';
import { InMemoryAlertaView } from '../stubs/in-memory-alerta-view.js';
import { InMemoryClienteFinalGateway } from '../stubs/in-memory-cliente-gateway.js';

// ---------------------------------------------------------------------------
// Fixtures compartilhadas
// ---------------------------------------------------------------------------

const TENANT = TenantId('tenant-sqs-001');
const CLIENTE = ClienteFinalId('cliente-sqs-001');
const USUARIO = UsuarioId('usuario-sqs-001');
const ALERTA_ID = AlertaId('alerta-sqs-001');

let sqsFixture: SqsFixture | null = null;
let dbFixture: DbFixture | null = null;

beforeAll(async () => {
  try {
    [sqsFixture, dbFixture] = await Promise.all([startLocalstackSqs(), startDb()]);
  } catch {
    // Docker não disponível (RAD-130) — testes serão pulados silenciosamente
  }
}, 120_000);

afterAll(async () => {
  await Promise.all([
    sqsFixture ? teardownLocalstack(sqsFixture) : Promise.resolve(),
    dbFixture ? teardownDb(dbFixture) : Promise.resolve(),
  ]);
});

// ---------------------------------------------------------------------------
// Helpers de consumo de fila (consumer loop para uso nos testes)
// ---------------------------------------------------------------------------

/**
 * Aguarda até uma mensagem aparecer na fila por polling de curto prazo.
 * Lança se o deadline for atingido sem mensagem.
 */
async function aguardarMensagem(
  filaUrl: string,
  timeoutMs: number,
  visibilityTimeout = 30,
): Promise<Message> {
  if (!sqsFixture) throw new Error('SQS não iniciado');
  const { sqs } = sqsFixture;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: filaUrl,
        MaxNumberOfMessages: 1,
        VisibilityTimeout: visibilityTimeout,
        WaitTimeSeconds: 0,
      }),
    );
    if (Messages?.[0]) return Messages[0];
    await new Promise<void>(r => setTimeout(r, 300));
  }
  throw new Error(`Nenhuma mensagem recebida em ${timeoutMs}ms (fila: ${filaUrl})`);
}

/**
 * Recebe mensagens em batch, acumulando até ter pelo menos `minMsgs` ou esgotar o deadline.
 * SQS pode retornar menos que MaxNumberOfMessages mesmo com mensagens disponíveis.
 */
async function receberBatch(
  filaUrl: string,
  minMsgs: number,
  maxMsgs: number,
  visibilityTimeout = 30,
  timeoutMs = 8_000,
): Promise<Message[]> {
  if (!sqsFixture) throw new Error('SQS não iniciado');
  const { sqs } = sqsFixture;
  const acumulado: Message[] = [];
  const seen = new Set<string>();
  const deadline = Date.now() + timeoutMs;

  while (acumulado.length < minMsgs && Date.now() < deadline) {
    const { Messages } = await sqs.send(
      new ReceiveMessageCommand({
        QueueUrl: filaUrl,
        MaxNumberOfMessages: maxMsgs,
        VisibilityTimeout: visibilityTimeout,
        WaitTimeSeconds: 0,
      }),
    );
    for (const m of Messages ?? []) {
      if (m.MessageId && !seen.has(m.MessageId)) {
        seen.add(m.MessageId);
        acumulado.push(m);
      }
    }
    if (acumulado.length < minMsgs) await new Promise<void>(r => setTimeout(r, 300));
  }
  return acumulado;
}

async function ack(filaUrl: string, receiptHandle: string): Promise<void> {
  if (!sqsFixture) throw new Error('SQS não iniciado');
  await sqsFixture.sqs.send(
    new DeleteMessageCommand({ QueueUrl: filaUrl, ReceiptHandle: receiptHandle }),
  );
}

async function nack(filaUrl: string, receiptHandle: string): Promise<void> {
  if (!sqsFixture) throw new Error('SQS não iniciado');
  await sqsFixture.sqs.send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: filaUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 0, // disponível imediatamente para reentrega
    }),
  );
}

// ---------------------------------------------------------------------------
// CE-SQS-01 — Redelivery real via visibility timeout dispara idempotência
// ---------------------------------------------------------------------------

describe('CE-SQS-01 — Redelivery real via visibility timeout dispara idempotência', () => {
  it(
    'alerta já notificado não gera segunda notificação quando a mensagem é reentregue',
    async () => {
      if (!sqsFixture || !dbFixture) return; // Docker não disponível — pula

      await dbFixture.pool.query(`TRUNCATE notificacao, usuario_preferencia`);

      // Fila com visibility timeout curto para redelivery rápida no teste
      const VIS_TIMEOUT_S = 3;
      const { filaUrl } = await criarFilaComDlq(sqsFixture.sqs, 'ce-sqs-01', {
        visibilityTimeout: VIS_TIMEOUT_S,
        maxReceiveCount: 5,
      });

      // Preferência do usuário: EMAIL imediato
      await dbFixture.pool.query(
        `INSERT INTO usuario_preferencia (usuario_id, canais, frequencia, atualizada_em)
         VALUES ($1, $2, $3, NOW())`,
        [USUARIO, ['EMAIL'], 'IMEDIATA'],
      );

      // Resumo do alerta disponível para o use case via InMemoryAlertaView
      const alertaView = new InMemoryAlertaView();
      alertaView.registrar({
        id: ALERTA_ID,
        objeto: 'Serviços de TI e desenvolvimento de software',
        orgao: 'Órgão Teste SQS',
        uf: 'SP',
        prazoProposta: new Date('2026-07-20'),
        aderencia: 0.85,
        diasAtePrazo: 9,
        criterioId: CriterioId('criterio-sqs-001'),
        criterioNome: 'TI e Software',
      });

      const clienteGateway = new InMemoryClienteFinalGateway();
      clienteGateway.registrar(CLIENTE, { usuarioId: USUARIO, email: 'sqs-e2e@radar.com' });

      const notifier = new CaptureNotifier();
      const notificacaoRepo = new PostgresNotificacaoRepository(dbFixture.db);
      const preferenciaRepo = new PostgresPreferenciaRepository(dbFixture.db);

      const uc = new NotificarAlertaUseCase(
        alertaView,
        preferenciaRepo,
        notificacaoRepo,
        notifier,
        { publicar: async () => {} },
        { gerar: () => crypto.randomUUID() },
        clienteGateway,
      );

      const worker = new NotificacaoWorker(uc, { encaminhar: async () => {} });
      const signal = new AbortController().signal;

      // Publica alerta.gerado na fila SQS real (formato Published Language — A03 §3)
      await sqsFixture.sqs.send(
        new SendMessageCommand({
          QueueUrl: filaUrl,
          MessageBody: JSON.stringify({
            type: 'alerta.gerado',
            occurredAt: new Date().toISOString(),
            payload: { alertaId: ALERTA_ID, tenantId: TENANT, clienteFinalId: CLIENTE },
          }),
        }),
      );

      // --- Primeira entrega ---
      const msg1 = await aguardarMensagem(filaUrl, 8_000, VIS_TIMEOUT_S);
      const payload1 = JSON.parse(msg1.Body!).payload as {
        alertaId: string;
        tenantId: string;
        clienteFinalId: string;
      };

      await worker.processar(payload1, signal);

      // Não deletamos a mensagem — simula crash após processar mas antes do ACK.
      // O visibility timeout (VIS_TIMEOUT_S) expira e o SQS reentrega a mensagem.
      expect(notifier.enviadas.length).toBe(1);

      // Aguarda expiração do visibility timeout + margem de segurança
      await new Promise<void>(r => setTimeout(r, (VIS_TIMEOUT_S + 0.6) * 1_000));

      // --- Segunda entrega (redelivery real pelo SQS, não re-chamada manual) ---
      const msg2 = await aguardarMensagem(filaUrl, 6_000, 30);
      const payload2 = JSON.parse(msg2.Body!).payload as typeof payload1;

      // jaNotificado retorna true → use case sai cedo sem enviar
      await worker.processar(payload2, signal);
      await ack(filaUrl, msg2.ReceiptHandle!);

      expect(notifier.enviadas.length).toBe(1); // sem duplicata — idempotência garantida
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// CE-SQS-02 — DLQ após maxReceiveCount NACKs (guardrail P-41)
// ---------------------------------------------------------------------------

describe('CE-SQS-02 — DLQ após maxReceiveCount NACKs (guardrail P-41)', () => {
  it(
    'mensagem chega à DLQ após ser NACKada N vezes consecutivas',
    async () => {
      if (!sqsFixture) return; // Docker não disponível — pula

      const MAX_RECEBIMENTOS = 3;
      const { filaUrl, dlqUrl } = await criarFilaComDlq(sqsFixture.sqs, 'ce-sqs-02', {
        maxReceiveCount: MAX_RECEBIMENTOS,
      });

      // Publica uma mensagem que sempre falhará no processamento (canal indisponível)
      await sqsFixture.sqs.send(
        new SendMessageCommand({
          QueueUrl: filaUrl,
          MessageBody: JSON.stringify({ alertaId: 'alerta-dlq-001' }),
        }),
      );

      // MAX_RECEBIMENTOS ciclos de falha — cada NACK não deleta a mensagem e
      // a torna imediatamente disponível (VisibilityTimeout=0) para o próximo ciclo.
      for (let tentativa = 1; tentativa <= MAX_RECEBIMENTOS; tentativa++) {
        const msg = await aguardarMensagem(filaUrl, 5_000, 30);

        // NACK: canal indisponível — não deleta, torna disponível imediatamente
        await nack(filaUrl, msg.ReceiptHandle!);
        await new Promise<void>(r => setTimeout(r, 200)); // aguarda processamento interno do LocalStack
      }

      // Após MAX_RECEBIMENTOS NACKs, o SQS deve mover a mensagem para a DLQ
      const dlqMsg = await aguardarMensagem(dlqUrl, 10_000, 30);
      expect(dlqMsg).toBeDefined();
      expect(JSON.parse(dlqMsg.Body!)).toMatchObject({ alertaId: 'alerta-dlq-001' });
      await ack(dlqUrl, dlqMsg.ReceiptHandle!);

      // Fila principal deve estar vazia — mensagem foi para a DLQ
      const { Messages: restantes } = await sqsFixture.sqs.send(
        new ReceiveMessageCommand({ QueueUrl: filaUrl, WaitTimeSeconds: 1 }),
      );
      expect(restantes ?? []).toHaveLength(0);
    },
    30_000,
  );
});

// ---------------------------------------------------------------------------
// CE-SQS-03 — Falha parcial de batch: boas mensagens confirmam, ruim vai para DLQ
// ---------------------------------------------------------------------------

describe('CE-SQS-03 — Falha parcial de batch: ACK seletivo por mensagem', () => {
  it(
    'numa batch de 3, só a mensagem com falha é NACKada; as demais são ACKadas e somem da fila',
    async () => {
      if (!sqsFixture) return; // Docker não disponível — pula

      const MAX_RECEBIMENTOS = 3;
      const { filaUrl, dlqUrl } = await criarFilaComDlq(sqsFixture.sqs, 'ce-sqs-03', {
        maxReceiveCount: MAX_RECEBIMENTOS,
      });

      // Publica 3 mensagens: 2 boas + 1 ruim (falha simulada de canal)
      const MENSAGENS = [
        { id: 'msg-ok-A', sucesso: true },
        { id: 'msg-falha', sucesso: false },
        { id: 'msg-ok-B', sucesso: true },
      ];
      for (const m of MENSAGENS) {
        await sqsFixture.sqs.send(
          new SendMessageCommand({ QueueUrl: filaUrl, MessageBody: JSON.stringify(m) }),
        );
      }

      // Recebe batch de até 3 (com retry — SQS pode retornar menos que o máximo)
      const batch = await receberBatch(filaUrl, 3, 3, 30, 8_000);
      expect(batch.length).toBe(3);

      // ACK seletivo: deleta mensagens boas, NACK na mensagem de falha
      let mensagemFalhaId: string | undefined;
      for (const msg of batch) {
        const body = JSON.parse(msg.Body!) as { id: string; sucesso: boolean };
        if (body.sucesso) {
          await ack(filaUrl, msg.ReceiptHandle!); // boas: removidas da fila
        } else {
          await nack(filaUrl, msg.ReceiptHandle!); // ruim: disponível imediatamente
          mensagemFalhaId = body.id;
        }
      }
      expect(mensagemFalhaId).toBe('msg-falha');

      // Apenas a mensagem de falha deve estar visível na fila principal
      const restante = await aguardarMensagem(filaUrl, 5_000, 30);
      expect(JSON.parse(restante.Body!)).toMatchObject({ id: 'msg-falha', sucesso: false });

      // Esgota as tentativas restantes para que a mensagem de falha vá para a DLQ
      // (já recebida 2× acima — contagem: 1=batch, 2=restante)
      await nack(filaUrl, restante.ReceiptHandle!);
      for (let i = 3; i <= MAX_RECEBIMENTOS; i++) {
        const msg = await aguardarMensagem(filaUrl, 5_000, 30);
        await nack(filaUrl, msg.ReceiptHandle!);
        await new Promise<void>(r => setTimeout(r, 200));
      }

      // Mensagem de falha deve ter chegado à DLQ
      const dlqMsg = await aguardarMensagem(dlqUrl, 10_000, 30);
      expect(JSON.parse(dlqMsg.Body!)).toMatchObject({ id: 'msg-falha' });
      await ack(dlqUrl, dlqMsg.ReceiptHandle!);

      // Fila principal deve estar completamente vazia
      const { Messages: sobras } = await sqsFixture.sqs.send(
        new ReceiveMessageCommand({ QueueUrl: filaUrl, WaitTimeSeconds: 1 }),
      );
      expect(sobras ?? []).toHaveLength(0);
    },
    30_000,
  );
});
