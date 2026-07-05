# Módulo: queue
# Fila gerenciada SQS com DLQ (retry + dead letter queue).
# Eventos de domínio entre módulos (EditalIngerido, AlertaGerado, etc.).
# Refs: arquitetura/03 (fluxo de eventos), arquitetura/08 §4

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

resource "aws_sqs_queue" "dlq" {
  name                      = "${var.project}-${var.env}-${var.queue_name}-dlq"
  message_retention_seconds = 1209600 # 14 dias
  kms_master_key_id         = var.kms_key_arn

  tags = local.tags
}

resource "aws_sqs_queue" "this" {
  name                       = "${var.project}-${var.env}-${var.queue_name}"
  visibility_timeout_seconds = var.visibility_timeout
  message_retention_seconds  = 86400 # 1 dia
  max_message_size           = 262144
  kms_master_key_id          = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })

  tags = local.tags
}

locals {
  tags = {
    project     = var.project
    environment = var.env
    queue       = var.queue_name
    managed_by  = "terraform"
  }
}
