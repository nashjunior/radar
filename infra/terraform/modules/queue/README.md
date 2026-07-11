# Módulo `queue` — fila gerenciada com DLQ (RAD-181/RAD-182)

Fila de mensagens com dead-letter queue. Binding hoje = AWS SQS.

## O que é genuinamente portável

| Conceito | Contrato | Binding AWS |
|---|---|---|
| URL de acesso | `queue_url` | SQS queue URL |
| Cifra em repouso | `encryption_key_ref` | KMS key ARN (`kms_master_key_id`) |
| Handle da fila | `queue_ref` | SQS queue ARN |
| Handle da DLQ | `dlq_ref` | SQS DLQ ARN |
| Visibilidade | `visibility_timeout` (segundos) | `visibility_timeout_seconds` |
| Retentativas | `max_receive_count` | `maxReceiveCount` no redrive_policy |
| Retenção | `message_retention_seconds` | `message_retention_seconds` |
| Orçamento de reentrega | `redelivery_budget_seconds` | — (gate de `plan`, não é atributo) |

## O que é provider-bound (custo real de exit → GCP/Azure)

- **`redrive_policy` / `deadLetterTargetArn`** — em GCP Pub/Sub a DLQ é uma subscription
  separada com `dead_letter_policy`; em Azure Service Bus é um sub-queue built-in.
- **`kms_master_key_id`** — AWS SQS usa KMS diretamente; em GCP Pub/Sub a cifra é pelo
  Cloud KMS via CMEK; em Azure Service Bus é via Customer-managed key no namespace.
- **`message_retention_seconds`** — SQS aceita até 14 dias; GCP Pub/Sub até 7 dias;
  Azure Service Bus até 14 dias (Basic/Standard).
- **`receive_wait_time_seconds` (long polling)** — é atributo **da fila** no SQS (0–20 s).
  Não tem equivalente em GCP Pub/Sub, que usa *streaming pull* (o long poll é propriedade do
  cliente, não da fila) — exit = deletar o atributo e mudar o consumidor. Azure Service Bus
  tem o análogo no `receive` do cliente, também não na entidade.
- **Gate de frescor (`lifecycle { precondition }`)** — `visibility_timeout * max_receive_count
  <= redelivery_budget_seconds`. É Terraform core (portável), mas o **acoplamento** que ele
  vigia é da semântica de reentrega do SQS: a mensagem fica invisível o timeout inteiro a
  cada tentativa, então o pior caso de reentrega é o produto dos dois. Deriva do frescor
  p95 ≤ 30 min (P-14). ⚠️ `terraform validate` **não** avalia precondition — só `plan`.
