# Módulo scheduled_shutdown — stop/start agendado do tier compute dev (RAD-225)
#
# Mecanismo confiável de custo independente do auto-pause do Aurora (que pode não
# engatar com RDS Proxy anexado, ver comentário em stacks/dev/main.tf).
# Economia: Aurora (~$50) + Fargate (~$18) só rodam ~40-50h/semana das 168.
#
# Binding: AWS — usa aws_scheduler_schedule (EventBridge Scheduler) com Universal Targets
# (AWS SDK) para invocar StopDBCluster/StartDBCluster e UpdateService sem Lambda intermediário.

locals {
  name_prefix = "${var.project}-${var.env}"

  # ARN de serviço usado na policy IAM e nas targets dos schedulers
  aurora_cluster_arn = "arn:aws:rds:${var.region}:${data.aws_caller_identity.current.account_id}:cluster:${var.aurora_cluster_id}"
  ecs_service_arn    = "arn:aws:ecs:${var.region}:${data.aws_caller_identity.current.account_id}:service/${var.ecs_cluster_name}/${var.ecs_service_name}"
}

data "aws_caller_identity" "current" {}

# ── IAM ──────────────────────────────────────────────────────────────────────

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
    Statement = [
      {
        Sid    = "AuroraStopStart"
        Effect = "Allow"
        Action = [
          "rds:StopDBCluster",
          "rds:StartDBCluster"
        ]
        Resource = local.aurora_cluster_arn
      },
      {
        Sid    = "ECSUpdateService"
        Effect = "Allow"
        Action = ["ecs:UpdateService"]
        Resource = local.ecs_service_arn
      }
    ]
  })
}

# ── Schedules ────────────────────────────────────────────────────────────────

# Schedule group isolado para facilitar visibilidade/cleanup
resource "aws_scheduler_schedule_group" "shutdown" {
  name = "${local.name_prefix}-shutdown"
}

# --- Aurora stop (fim de expediente) ---
resource "aws_scheduler_schedule" "aurora_stop" {
  name       = "${local.name_prefix}-aurora-stop"
  group_name = aws_scheduler_schedule_group.shutdown.name

  schedule_expression          = var.cron_stop
  schedule_expression_timezone = "America/Sao_Paulo"
  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:stopDBCluster"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ DbClusterIdentifier = var.aurora_cluster_id })
  }
}

# --- Aurora start (início de expediente) ---
resource "aws_scheduler_schedule" "aurora_start" {
  name       = "${local.name_prefix}-aurora-start"
  group_name = aws_scheduler_schedule_group.shutdown.name

  schedule_expression          = var.cron_start
  schedule_expression_timezone = "America/Sao_Paulo"
  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:rds:startDBCluster"
    role_arn = aws_iam_role.scheduler.arn
    input    = jsonencode({ DbClusterIdentifier = var.aurora_cluster_id })
  }
}

# --- ECS stop (zerar desired_count) ---
resource "aws_scheduler_schedule" "ecs_stop" {
  name       = "${local.name_prefix}-ecs-stop"
  group_name = aws_scheduler_schedule_group.shutdown.name

  schedule_expression          = var.cron_stop
  schedule_expression_timezone = "America/Sao_Paulo"
  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ecs:updateService"
    role_arn = aws_iam_role.scheduler.arn
    input = jsonencode({
      Cluster      = var.ecs_cluster_name
      Service      = var.ecs_service_name
      DesiredCount = 0
    })
  }
}

# --- ECS start (religar 1 task) ---
resource "aws_scheduler_schedule" "ecs_start" {
  name       = "${local.name_prefix}-ecs-start"
  group_name = aws_scheduler_schedule_group.shutdown.name

  schedule_expression          = var.cron_start
  schedule_expression_timezone = "America/Sao_Paulo"
  flexible_time_window { mode = "OFF" }

  target {
    arn      = "arn:aws:scheduler:::aws-sdk:ecs:updateService"
    role_arn = aws_iam_role.scheduler.arn
    input = jsonencode({
      Cluster      = var.ecs_cluster_name
      Service      = var.ecs_service_name
      DesiredCount = 1
    })
  }
}
