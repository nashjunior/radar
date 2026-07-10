# Módulo: serverless
# Funções Lambda dos workers assíncronos (ingestão/matching/notificação) com
# RESERVED CONCURRENCY como TETO de conexões ao banco (P-41/RAD-165).
#
# Cada invocação abre ~1 conexão pelo RDS Proxy → limitar a concorrência = limitar os
# backends. `reserved_concurrent_executions` é o teto por função; para os workers
# dirigidos por SQS, `scaling_config.maximum_concurrency` espelha esse teto na fila.
# A soma dos tetos respeita `max_connections=200` com folga de admin.
#
# ESTE É O SEAM SERVERLESS DE P-27 — no MVP-Now os consumers coabitam `apps/api`
# (Fargate, P-96 item 4, gated por WORKERS_ENABLED). Este módulo é o DESTINO quando A09
# justificar o isolamento; fica gated nos stacks (`enable_serverless_workers=false`).
# O valor entregue agora: o TETO (reserved concurrency) e o wiring (endpoint do proxy,
# VPC, secrets) escritos e validados. Refs: arquitetura/08 §2, docs/98 P-41/P-27/P-96.

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

  # Funções dirigidas por fila (têm queue_arn) ganham event source mapping.
  sqs_functions = { for k, f in var.functions : k => f if f.queue_arn != null }
}

# IAM: role de execução compartilhada dos workers.
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

# ENI na VPC (para alcançar o proxy) + logs.
resource "aws_iam_role_policy_attachment" "vpc" {
  role       = aws_iam_role.worker.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "worker" {
  statement {
    sid       = "ReadSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = var.secret_arns
  }
  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [var.kms_key_arn]
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

# SG dos workers — egress 5432 p/ o SG do proxy (nunca o banco direto).
resource "aws_security_group" "worker" {
  name        = "${var.project}-${var.env}-worker-sg"
  description = "Workers serverless — egress somente ao RDS Proxy"
  vpc_id      = var.vpc_id

  egress {
    description     = "Postgres via RDS Proxy"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.proxy_security_group_id]
  }

  egress {
    description = "HTTPS (Secrets Manager, SQS, Bedrock via endpoints)"
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

  # Seam ainda não empacotado — pacote placeholder até a extração (P-27). O apply real
  # substitui por artefato de build; validate não lê o arquivo.
  filename = var.lambda_package_path

  # O TETO (P-41). Soma validada em var.functions contra max_connections.
  reserved_concurrent_executions = each.value.reserved_concurrency

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = [aws_security_group.worker.id]
  }

  environment {
    variables = {
      NODE_ENV = var.env
      # DATABASE_URL aponta para o ENDPOINT DO PROXY do pool desta função, nunca o cluster.
      DB_PROXY_ENDPOINT       = each.value.proxy_endpoint
      DATABASE_URL_SECRET_ARN = var.database_url_secret_arn
      WORKLOAD_POOL           = each.value.pool
    }
  }

  depends_on = [aws_cloudwatch_log_group.worker]

  tags = merge(local.tags, { pool = each.value.pool })
}

# Fila→função: maximum_concurrency espelha o teto de reserved concurrency (SQS não pode
# escalar além do teto e estourar o pool de conexões).
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
