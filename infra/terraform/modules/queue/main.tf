# Módulo: queue
# Fila gerenciada com DLQ (retry + dead-letter). Eventos de domínio entre módulos.
# Binding hoje = AWS SQS. Contrato usa `encryption_key_ref`/`queue_ref`/`dlq_ref`.
# Refs: arquitetura/03 (fluxo de eventos); arquitetura/08 §4; RAD-181/RAD-182

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    queue       = var.queue_name
    managed_by  = "terraform"
  }
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.project}-${var.env}-${var.queue_name}-dlq"
  message_retention_seconds = 1209600 # 14 dias
  kms_master_key_id         = var.encryption_key_ref

  tags = local.tags
}

resource "aws_sqs_queue" "this" {
  name                       = "${var.project}-${var.env}-${var.queue_name}"
  visibility_timeout_seconds = var.visibility_timeout
  message_retention_seconds  = var.message_retention_seconds
  receive_wait_time_seconds  = var.receive_wait_time_seconds
  max_message_size           = 262144
  kms_master_key_id          = var.encryption_key_ref

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = local.tags

  # Gate de plano do invariante de frescor (ver variables.tf: redelivery_budget_seconds).
  # `terraform validate` NÃO avalia precondition — só `plan`/`apply`. É de propósito: o
  # acoplamento visibility x max_receive só é violável com valores concretos do stack.
  lifecycle {
    precondition {
      condition     = var.visibility_timeout * var.max_receive_count <= var.redelivery_budget_seconds
      error_message = "Fila '${var.queue_name}': visibility_timeout (${var.visibility_timeout}s) x max_receive_count (${var.max_receive_count}) = ${var.visibility_timeout * var.max_receive_count}s excede o orçamento de reentrega (${var.redelivery_budget_seconds}s). Uma mensagem re-tentada nasceria fora do frescor p95 <= 30 min (P-14). Baixe um dos dois, ou conserte o p99 do consumidor."
    }
  }
}
