# Módulo: serverless
# Funções serverless dos workers assíncronos (ingestão/matching/notificação).
# Binding hoje = AWS Lambda. RESERVED_CONCURRENT_EXECUTIONS = teto de conexões ao banco (P-41).
# Seam P-27: gated off no MVP-Now (workers coabitam apps/api Fargate, P-96).
# Contrato usa `network_id`, `private_subnet_ids`, `proxy_firewall_group_ref`,
# `encryption_key_ref`, `secret_refs`, `*_secret_ref` (neutros).
# Refs: arquitetura/08 §2; docs/98 P-41/P-27/P-96; RAD-181/RAD-182

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
    managed_by  = "terraform"
  }

  sqs_functions = { for k, f in var.functions : k => f if f.queue_arn != null }
}

data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "worker" {
  name               = "${var.project}-${var.env}-worker-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = local.tags
}

resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "ReadSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_refs
  }
  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [var.encryption_key_ref]
    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
  statement {
    sid       = "ConsumeQueues"
    actions   = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"]
    resources = [for _, f in local.sqs_functions : f.queue_arn]
  }
}

resource "aws_iam_role_policy" "worker" {
  name   = "${var.project}-${var.env}-worker-policy"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker.json
}

# SG dos workers — egress 5432 somente ao SG do proxy (nunca ao banco direto, P-41).
resource "aws_security_group" "worker" {
  name        = "${var.project}-${var.env}-worker-sg"
  description = "Workers serverless: egress somente ao pool gerenciado"
  vpc_id      = var.network_id

  egress {
    description     = "Postgres via pool gerenciado"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.proxy_firewall_group_ref]
  }

  egress {
    description = "HTTPS (Secrets Manager, SQS via endpoints)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "worker" {
  for_each = var.functions

  name              = "/aws/lambda/${var.project}-${var.env}-${each.key}"
  retention_in_days = var.env == "prod" ? 30 : 7
  tags              = local.tags
}

resource "aws_lambda_function" "worker" {
  for_each = var.functions

  function_name = "${var.project}-${var.env}-${each.key}"
  role          = aws_iam_role.worker.arn
  runtime       = each.value.runtime
  handler       = each.value.handler
  timeout       = each.value.timeout
  memory_size   = each.value.memory_size

  # Seam ainda não empacotado — placeholder até a extração (P-27).
  filename = var.lambda_package_path

  # O TETO de conexões ao banco (P-41).
  reserved_concurrent_executions = each.value.reserved_concurrency

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.worker.id]
  }

  environment {
    variables = {
      NODE_ENV                = var.env
      DB_PROXY_ENDPOINT       = each.value.proxy_endpoint
      DATABASE_URL_SECRET_ARN = var.database_url_secret_ref
      WORKLOAD_POOL           = each.value.pool
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]

  tags = merge(local.tags, { pool = each.value.pool })
}

# Fila→função: maximum_concurrency espelha o teto (SQS não pode escalar além do teto).
resource "aws_lambda_event_source_mapping" "sqs" {
  for_each = local.sqs_functions

  event_source_arn = each.value.queue_arn
  function_name    = aws_lambda_function.worker[each.key].arn
  batch_size       = each.value.batch_size
  enabled          = var.enabled

  scaling_config {
    maximum_concurrency = each.value.reserved_concurrency
  }
}

# Funções AGENDADAS (queue_arn=null) — ingestão/health (arq/08 §2: "serverless job
# agendado"). EventBridge Scheduler invoca a função na cadência do schedule_expression.
locals {
  scheduled_functions = { for k, f in var.functions : k => f if f.queue_arn == null }
}

data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  count              = length(local.scheduled_functions) > 0 ? 1 : 0
  name               = "${var.project}-${var.env}-worker-scheduler-role"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
  tags               = local.tags
}

data "aws_iam_policy_document" "scheduler_invoke" {
  count = length(local.scheduled_functions) > 0 ? 1 : 0
  statement {
    sid       = "InvokeScheduledWorkers"
    actions   = ["lambda:InvokeFunction"]
    resources = [for k, _ in local.scheduled_functions : aws_lambda_function.worker[k].arn]
  }
}

resource "aws_iam_role_policy" "scheduler" {
  count  = length(local.scheduled_functions) > 0 ? 1 : 0
  name   = "${var.project}-${var.env}-worker-scheduler-policy"
  role   = aws_iam_role.scheduler[0].id
  policy = data.aws_iam_policy_document.scheduler_invoke[0].json
}

resource "aws_scheduler_schedule" "worker" {
  for_each = local.scheduled_functions

  name = "${var.project}-${var.env}-${each.key}"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = each.value.schedule_expression
  state               = var.enabled ? "ENABLED" : "DISABLED"

  target {
    arn      = aws_lambda_function.worker[each.key].arn
    role_arn = aws_iam_role.scheduler[0].arn
  }
}
