variable "project" {
  description = "Nome do projeto (usado em tags e nomes de recurso)"
  type        = string
}

variable "env" {
  description = "Ambiente (dev apenas — este módulo NÃO deve aparecer em prod/staging)"
  type        = string
  default     = "dev"

  validation {
    condition     = var.env == "dev"
    error_message = "scheduled_shutdown é exclusivo do ambiente dev."
  }
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "aurora_cluster_id" {
  description = "Cluster identifier do Aurora a ser parado/iniciado. Binding: aws_rds_cluster.cluster_identifier"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Nome do ECS cluster a ter o serviço zerado. Binding: aws_ecs_cluster.name"
  type        = string
}

variable "ecs_service_name" {
  description = "Nome do ECS service cujo desired_count vai a 0. Binding: aws_ecs_service.name"
  type        = string
}

# Horários em America/Sao_Paulo (UTC-3):
#   - Ligar   08:00 BRT → 11:00 UTC  → cron(0 11 ? * MON-FRI *)
#   - Desligar 20:00 BRT → 23:00 UTC → cron(0 23 ? * MON-FRI *)
#   - Sexta 20:00 BRT já está coberta pelo weekday cron; fim-de-semana nunca liga.
variable "cron_stop" {
  description = "Cron expression (UTC) para desligar fora do horário comercial"
  type        = string
  default     = "cron(0 23 ? * MON-FRI *)" # 20:00 BRT → 23:00 UTC
}

variable "cron_start" {
  description = "Cron expression (UTC) para religar no início do horário comercial"
  type        = string
  default     = "cron(0 11 ? * MON-FRI *)" # 08:00 BRT → 11:00 UTC
}
