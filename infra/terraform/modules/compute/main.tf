# Módulo: compute
# Container quente para apps/api. Binding hoje = AWS ECS Fargate.
# Contrato usa `region`, `container_image_uri`, `*_secret_ref` (neutros);
# recursos internos (ECS cluster/task-def/IAM) documentados como provider-bound.
# Refs: arquitetura/08 §§4,11; docs/98 P-64/P-86; RAD-181/RAD-182

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
}

resource "aws_ecs_cluster" "this" {
  name = "${var.project}-${var.env}"

  setting {
    name  = "containerInsights"
    value = var.env == "prod" ? "enabled" : "disabled"
  }

  tags = local.tags
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${var.project}-${var.env}-api"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${var.container_image_uri}:${var.image_tag}"
      essential = true

      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      environment = [
        { name = "NODE_ENV", value = var.env },
        { name = "PORT", value = "3000" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = var.database_url_secret_ref },
        { name = "FIELD_CRYPTO_KEY", valueFrom = var.field_crypto_key_secret_ref },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = "/ecs/${var.project}-${var.env}/api"
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])

  tags = local.tags
}

resource "aws_iam_role" "ecs_execution" {
  name = "${var.project}-${var.env}-ecs-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  managed_policy_arns = [
    "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
  ]

  tags = local.tags
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.project}-${var.env}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
    }]
  })

  tags = local.tags
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${var.project}-${var.env}/api"
  retention_in_days = var.env == "prod" ? 30 : 7
  tags              = local.tags
}

# --- IAM: as duas roles precisam de permissão DE VERDADE ------------------------------
#
# `AmazonECSTaskExecutionRolePolicy` (anexada acima) dá ECR + Logs e MAIS NADA. A task def
# injeta DATABASE_URL/FIELD_CRYPTO_KEY via `secrets`/`valueFrom`, e o agente do ECS usa a
# EXECUTION role pra buscá-los. Sem estas policies a task morre em
# `ResourceInitializationError: unable to pull secrets` — e, pior, o `apply` SAI 0: o serviço
# fica com 0 tasks sãs e a falha só aparece no console. Enquanto não havia `aws_ecs_service`
# isso era inerte; ao criar o serviço, vira bomba armada. Daí as duas policies abaixo.

# EXECUTION role: ler os segredos da task def + decifrar com a CMK que os protege.
resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${var.project}-${var.env}-ecs-exec-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [var.database_url_secret_ref, var.field_crypto_key_secret_ref]
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.encryption_key_ref]
        # Só via Secrets Manager — a execution role não decifra nada mais com esta chave.
        Condition = {
          StringEquals = { "kms:ViaService" = "secretsmanager.${var.region}.amazonaws.com" }
        }
      },
    ]
  })
}

# TASK role: o que a APLICAÇÃO faz em runtime — consumir/produzir as filas do fan-out
# (RAD-179) e decifrar/cifrar as mensagens (as filas são CMK). Escopada nos ARNs das filas:
# nada de `Resource: "*"` em SQS. `queue_refs` vazio => nenhuma policy (nada a permitir).
resource "aws_iam_role_policy" "ecs_task_queues" {
  count = length(var.queue_refs) == 0 ? 0 : 1

  name = "${var.project}-${var.env}-ecs-task-queues"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:DeleteMessageBatch",
          "sqs:SendMessage",
          "sqs:SendMessageBatch",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ChangeMessageVisibility",
        ]
        Resource = var.queue_refs
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.encryption_key_ref]
        Condition = {
          StringEquals = { "kms:ViaService" = "sqs.${var.region}.amazonaws.com" }
        }
      },
    ]
  })
}

# --- Serviço -------------------------------------------------------------------------
#
# Até RAD-192 este módulo tinha cluster + task definition + roles + log e MAIS NADA: sem
# `aws_ecs_service`, nada nunca RODARIA a task. Isso importa aqui porque autoscaling de ECS
# escala o `DesiredCount` DE UM SERVIÇO — sem serviço, `aws_appautoscaling_target` não tem
# onde grudar. Então o serviço vem junto: é o alvo, não um extra.
#
# Sem `load_balancer` enquanto a borda não existir (P-55) — o serviço sobe e processa fila
# (a task role abaixo lhe dá SQS), mas não recebe HTTP.
#
# ⚠️ O módulo NÃO está instanciado em nenhum stack, de propósito: as sub-redes privadas ainda
# não têm rota de saída (sem NAT, sem VPC endpoint), então a task não puxaria a imagem do ECR
# nem leria o segredo — e o `apply` sairia 0 mesmo assim, com 0 task sã. Os pré-requisitos
# (egress, imagem/ECR, borda) estão em RAD-193; é lá que este módulo é wireado.

resource "aws_security_group" "tasks" {
  name        = "${var.project}-${var.env}-tasks-sg"
  description = "Tasks do tier sempre-ligado (API/BFF + triagem-pool)"
  vpc_id      = var.network_id

  tags = local.tags
}

# 5432 SÓ para o SG do pooler (SG→SG, não CIDR): a task não alcança o cluster direto nem
# nada mais na rede por 5432 (P-41 — "nunca pro RDS direto"). O handle vem do stack, igual
# ao módulo `serverless` — composição no stack, não módulo importando módulo (A08 §1).
resource "aws_vpc_security_group_egress_rule" "tasks_pooler" {
  security_group_id            = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = var.pooler_firewall_group_ref
  description                  = "Postgres via RDS Proxy (P-41)"
}

# ⚠️ 443 aberto espelha o SG do módulo `serverless` (mesma postura, mesma dívida). O egress
# allowlist de SSRF é P-58 e está ABERTO: fechar aqui sozinho quebraria ECR/Secrets/PNCP/LLM
# sem uma allowlist decidida. Quando P-58 fechar, os DOIS SGs apertam juntos.
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  security_group_id = aws_security_group.tasks.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "HTTPS de saída — ECR/Secrets/CloudWatch/PNCP/LLM (apertar com P-58)"
}

resource "aws_ecs_service" "api" {
  name            = "${var.project}-${var.env}-api"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.api.arn
  launch_type     = "FARGATE"

  # Piso do autoscaling. FARGATE puro (não SPOT): A04 §6 — "Ingestão + matching + alerta
  # NUNCA sacrificar" — este tier não aceita interrupção por preço.
  desired_count = var.min_capacity

  network_configuration {
    subnets          = var.private_subnet_ids
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false # A08 §5: sub-rede privada, sem IP público
  }

  # Deploy ruim volta sozinho em vez de deixar o tier sempre-ligado no chão.
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  dynamic "load_balancer" {
    for_each = var.target_group_ref == null ? [] : [var.target_group_ref]
    content {
      target_group_arn = load_balancer.value
      container_name   = "api"
      container_port   = 3000
    }
  }

  # `health_check_grace_period_seconds` só é válido COM balanceador — daí o null.
  health_check_grace_period_seconds = var.target_group_ref == null ? null : 60

  propagate_tags = "SERVICE"
  tags           = local.tags

  # Quem manda no desired_count depois do create é o autoscaling. Sem isto, todo `apply`
  # devolveria o serviço ao piso, desfazendo um scale-out no meio de um pico.
  lifecycle {
    ignore_changes = [desired_count]
  }
}

# --- Autoscaling (target tracking) -----------------------------------------------------

resource "aws_appautoscaling_target" "api" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.min_capacity
  max_capacity       = var.max_capacity

  lifecycle {
    precondition {
      condition     = var.max_capacity >= var.min_capacity
      error_message = "max_capacity (${var.max_capacity}) < min_capacity (${var.min_capacity}) — teto abaixo do piso."
    }
  }
}

resource "aws_appautoscaling_policy" "cpu" {
  name               = "${var.project}-${var.env}-api-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.cpu_target_percent
    scale_out_cooldown = var.scale_out_cooldown_seconds
    scale_in_cooldown  = var.scale_in_cooldown_seconds
  }
}

resource "aws_appautoscaling_policy" "memory" {
  name               = "${var.project}-${var.env}-api-memory"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = var.memory_target_percent
    scale_out_cooldown = var.scale_out_cooldown_seconds
    scale_in_cooldown  = var.scale_in_cooldown_seconds
  }
}

# Terceira métrica — só existe quando a borda existir (P-55). Ver variables.tf.
resource "aws_appautoscaling_policy" "requests" {
  count = var.request_scaling_target_ref == null ? 0 : 1

  name               = "${var.project}-${var.env}-api-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.api.service_namespace
  resource_id        = aws_appautoscaling_target.api.resource_id
  scalable_dimension = aws_appautoscaling_target.api.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = var.request_scaling_target_ref
    }
    target_value       = var.requests_per_target_target
    scale_out_cooldown = var.scale_out_cooldown_seconds
    scale_in_cooldown  = var.scale_in_cooldown_seconds
  }
}
