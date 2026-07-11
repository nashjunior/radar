# Módulo scheduled_shutdown — stop/start agendado do tier compute dev (RAD-225)
#
# Mecanismo confiável de custo independente do auto-pause do Aurora (que pode não
# engatar com RDS Proxy anexado, ver comentário em stacks/dev/main.tf).
# Economia: Aurora (~$50) + Fargate (~$18) só rodam ~40-50h/semana das 168.
#
# Binding: AWS. Dois mecanismos DIFERENTES, um por serviço — ver README §Por que dois:
#   - Aurora → EventBridge Scheduler + Universal Target (aws-sdk:rds), sem Lambda.
#   - ECS    → Application Auto Scaling scheduled action, NÃO UpdateService.

locals {
  name_prefix = "${var.project}-${var.env}"

  aurora_cluster_arn = "arn:aws:rds:${var.region}:${data.aws_caller_identity.current.account_id}:cluster:${var.aurora_cluster_ref}"

  # Endereço do scalable target que o módulo compute registra (aws_appautoscaling_target.api).
  ecs_scalable_target_id = "service/${var.ecs_cluster_name}/${var.ecs_service_name}"
}

data "aws_caller_identity" "current" {}

# ── Aurora: EventBridge Scheduler ────────────────────────────────────────────
#
# Aurora não tem "scalable target"; parar o cluster é uma chamada de API. O Scheduler
# invoca o SDK direto (Universal Target), sem Lambda intermediário para manter.

resource "aws_iam_role" "scheduler" {
  name = "${local.name_prefix}-scheduler-shutdown"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler" {
  name = "scheduled-shutdown-actions"
  role = aws_iam_role.scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "AuroraStopStart"
      Effect = "Allow"
      Action = [
        "rds:StopDBCluster",
        "rds:StartDBCluster",
      ]
      Resource = local.aurora_cluster_arn
    }]
  })
}

resource "aws_scheduler_schedule_group" "shutdown" {
  name = "${local.name_prefix}-shutdown"
}

resource "aws_scheduler_schedule" "aurora_stop" {
  name       = "${local.name_prefix}-aurora-stop"
  group_name = aws_scheduler_schedule_group.shutdown.name

  schedule_expression          = var.cron_stop
  schedule_expression_timezone = var.timezone
  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:stopDBCluster"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ DbClusterIdentifier = var.aurora_cluster_ref })
  }
}

resource "aws_scheduler_schedule" "aurora_start" {
  name       = "${local.name_prefix}-aurora-start"
  group_name = aws_scheduler_schedule_group.shutdown.name

  schedule_expression          = var.cron_start
  schedule_expression_timezone = var.timezone
  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:startDBCluster"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ DbClusterIdentifier = var.aurora_cluster_ref })
  }
}

# ── ECS: Application Auto Scaling scheduled actions ──────────────────────────
#
# NÃO usar ecs:UpdateService com DesiredCount=0 aqui: o módulo compute registra um
# aws_appautoscaling_target com min_capacity=1, e o Application Auto Scaling reconcilia
# a capacidade de volta para dentro de [min, max]. Zerar o serviço por UpdateService seria
# desfeito pelo autoscaling em minutos — a economia do Fargate simplesmente não ocorreria.
#
# O mecanismo correto é mover o PRÓPRIO min/max do scalable target: com min=max=0 o
# autoscaling drena o serviço a zero e o mantém lá; no religar, min=1 o traz de volta.

resource "aws_appautoscaling_scheduled_action" "ecs_stop" {
  name               = "${local.name_prefix}-ecs-stop"
  service_namespace  = "ecs"
  resource_id        = local.ecs_scalable_target_id
  scalable_dimension = "ecs:service:DesiredCount"

  schedule = var.cron_stop
  timezone = var.timezone

  scalable_target_action {
    min_capacity = 0
    max_capacity = 0
  }
}

resource "aws_appautoscaling_scheduled_action" "ecs_start" {
  name               = "${local.name_prefix}-ecs-start"
  service_namespace  = "ecs"
  resource_id        = local.ecs_scalable_target_id
  scalable_dimension = "ecs:service:DesiredCount"

  schedule = var.cron_start
  timezone = var.timezone

  scalable_target_action {
    min_capacity = var.ecs_min_capacity_on
    max_capacity = var.ecs_max_capacity_on
  }
}
