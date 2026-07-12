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

data "aws_caller_identity" "current" {}

locals {
  tags = {
    project     = var.project
    environment = var.env
    managed_by  = "terraform"
  }

  # NODE_ENV é contrato do RUNTIME (Node/libs) e do fail-closed de auth (P-91: `AUTH_MODE=dev`
  # é proibido em `NODE_ENV=production`) — não é o nome do ambiente. Passar "prod" aqui, como
  # estava, deixaria o Node em modo development E desarmaria o guarda de P-91, calado.
  node_env = var.env == "dev" ? "development" : "production"

  # Todos os segredos que a EXECUTION role precisa buscar no cofre para montar a task.
  secret_refs = concat(
    [var.database_url_secret_ref, var.field_crypto_key_secret_ref],
    values(var.extra_secret_refs),
  )
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

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${var.container_image_uri}:${var.image_tag}"
      essential = true

      portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]

      environment = concat(
        [
          { name = "NODE_ENV", value = local.node_env },
          { name = "PORT", value = tostring(var.container_port) },
        ],
        [for k in sort(keys(var.environment)) : { name = k, value = var.environment[k] }],
      )

      secrets = concat(
        [
          { name = "DATABASE_URL", valueFrom = var.database_url_secret_ref },
          { name = "FIELD_CRYPTO_KEY", valueFrom = var.field_crypto_key_secret_ref },
        ],
        [for k in sort(keys(var.extra_secret_refs)) : { name = k, valueFrom = var.extra_secret_refs[k] }],
      )

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

  tags = local.tags
}

# ECR pull + CloudWatch Logs. Dá isso e NADA MAIS — segredo e fila vêm das policies abaixo.
# (Era `managed_policy_arns` inline; o argumento está deprecado no provider e o aviso só
# apareceu agora, quando o módulo passou a ser instanciado de fato.)
resource "aws_iam_role_policy_attachment" "ecs_execution_base" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
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
        Resource = local.secret_refs
      },
      {
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [var.encryption_key_ref]
        # A MESMA chave protege o cofre E as camadas da imagem no registro (módulo `registry`).
        # Sem o `ViaService` de ECR aqui, o pull da imagem cifrada por CMK falha — e falha do
        # jeito pior: `apply` sai 0 e o serviço fica com 0 task sã.
        Condition = {
          StringEquals = {
            "kms:ViaService" = [
              "secretsmanager.${var.region}.amazonaws.com",
              "ecr.${var.region}.amazonaws.com",
            ]
          }
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

# TASK role: submeter/monitorar o job de batch inference do Bedrock (P-92/RAD-236) — o
# worker grava o JSONL de entrada, dispara `CreateModelInvocationJob` passando a role de
# serviço do Bedrock (módulo `storage`), e lê o JSONL de saída. O corpo da policy interpola
# os dois vars (role E bucket); qualquer um nulo => nenhuma policy (nada a permitir), mesmo
# padrão de `queue_refs` acima — nunca só um dos dois, senão o outro fica sem efeito.
resource "aws_iam_role_policy" "ecs_task_bedrock_batch" {
  count = (var.bedrock_batch_service_role_ref != null && var.batch_bucket_ref != null) ? 1 : 0

  name = "${var.project}-${var.env}-ecs-task-bedrock-batch"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BatchJobs"
        Effect = "Allow"
        Action = [
          "bedrock:CreateModelInvocationJob",
          "bedrock:GetModelInvocationJob",
          "bedrock:StopModelInvocationJob",
        ]
        Resource = [
          "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:model-invocation-job/*",
          "arn:aws:bedrock:${var.region}:${data.aws_caller_identity.current.account_id}:inference-profile/*",
          "arn:aws:bedrock:*::foundation-model/anthropic.*",
        ]
      },
      {
        Sid      = "PassBatchServiceRole"
        Effect   = "Allow"
        Action   = ["iam:PassRole"]
        Resource = [var.bedrock_batch_service_role_ref]
        Condition = {
          StringEquals = { "iam:PassedToService" = "bedrock.amazonaws.com" }
        }
      },
      {
        Sid      = "WriteInput"
        Effect   = "Allow"
        Action   = ["s3:PutObject"]
        Resource = ["${var.batch_bucket_ref}/batch/input/*"]
      },
      {
        Sid      = "ReadOutput"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${var.batch_bucket_ref}/batch/output/*"]
      },
      {
        Sid      = "ListPrefixes"
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = [var.batch_bucket_ref]
        Condition = {
          StringLike = { "s3:prefix" = ["batch/input/*", "batch/output/*"] }
        }
      },
      {
        Sid      = "Decrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt", "kms:GenerateDataKey"]
        Resource = [var.encryption_key_ref]
        Condition = {
          StringEquals = { "kms:ViaService" = "s3.${var.region}.amazonaws.com" }
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
# Sem `load_balancer`, o serviço sobe e processa fila (a task role abaixo lhe dá SQS) mas não
# recebe HTTP. Com a borda de RAD-199 (`edge`), o stack passa `target_group_ref` e o serviço
# passa a servir também.
#
# Os três pré-requisitos que mantinham este módulo fora dos stacks fecharam em RAD-199:
# saída da sub-rede privada (`vpc.egress_gateway_count`), imagem/registro (`registry` +
# `apps/api/Dockerfile`) e borda (`edge`, P-55 = ALB). Antes disso, instanciar aqui criaria um
# serviço cujas tasks nunca sobem — com `apply` saindo 0.

resource "aws_security_group" "tasks" {
  name        = "${var.project}-${var.env}-tasks-sg"
  description = "Tasks do tier sempre-ligado (API/BFF + triagem-pool)"
  vpc_id      = var.network_id

  tags = local.tags
}

# Único ingresso da task: a borda, na porta do container. SG→SG — nem CIDR da rede, nem
# internet. A task continua sem IP público (guardrail PRESERVAR, A08 §5).
resource "aws_vpc_security_group_ingress_rule" "tasks_from_edge" {
  count = var.edge_firewall_group_ref == null ? 0 : 1

  security_group_id            = aws_security_group.tasks.id
  ip_protocol                  = "tcp"
  from_port                    = var.container_port
  to_port                      = var.container_port
  referenced_security_group_id = var.edge_firewall_group_ref
  description                  = "HTTP somente da borda (P-55)"
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

# ⚠️ 443 aberto espelha o SG do módulo `serverless` (mesma postura, mesma dívida). P-58
# está RESOLVIDO (RAD-159/RAD-199) mas com a rede DELIBERADAMENTE aberta: quem sustenta a
# allowlist é o `SsrfGuard` no código (destinos são públicos — PNCP/LLM sem PrivateLink — e
# um egress firewall de rede ficou como hardening futuro sem gate hoje, docs/98 P-58). Fechar
# aqui sozinho quebraria ECR/Secrets/CloudWatch/PNCP/LLM sem uma allowlist de rede decidida.
# Achado esperado do Trivy (AWS-0104) — ver .trivyignore.yaml.
resource "aws_vpc_security_group_egress_rule" "tasks_https" {
  security_group_id = aws_security_group.tasks.id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
  description       = "HTTPS de saida: ECR/Secrets/CloudWatch/PNCP/LLM (apertar com P-58)"
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

  # Sem isto, o `apply` termina verde antes de a primeira task ficar sã — e uma imagem ausente
  # ou um segredo sem versão viram "0 task sã" descoberto no console, dias depois.
  wait_for_steady_state = var.wait_for_steady_state

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
      container_port   = var.container_port
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
