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
    error_message = "scheduled_shutdown é exclusivo do ambiente dev — prod/staging não desligam."
  }
}

variable "region" {
  description = "AWS region"
  type        = string
}

variable "aurora_cluster_ref" {
  description = "Cluster identifier do Aurora a parar/iniciar. Binding: aws_rds_cluster.cluster_identifier"
  type        = string
}

variable "ecs_cluster_name" {
  description = "Nome do ECS cluster do serviço a drenar. Binding: aws_ecs_cluster.name"
  type        = string
}

variable "ecs_service_name" {
  description = "Nome do ECS service a drenar. Binding: aws_ecs_service.name"
  type        = string
}

variable "ecs_min_capacity_on" {
  description = "min_capacity restaurado no religar. DEVE bater com o min_capacity do módulo compute"
  type        = number
  default     = 1
}

variable "ecs_max_capacity_on" {
  description = "max_capacity restaurado no religar. DEVE bater com o max_capacity do módulo compute"
  type        = number
  default     = 2
}

variable "timezone" {
  description = "Timezone em que os crons abaixo são interpretados (IANA)"
  type        = string
  default     = "America/Sao_Paulo"
}

# Os crons são interpretados em `var.timezone` (America/Sao_Paulo), NÃO em UTC — tanto o
# EventBridge Scheduler (schedule_expression_timezone) quanto o Application Auto Scaling
# (timezone) recebem o fuso explicitamente. Escreva os horários como o time os lê no relógio;
# não pré-converta para UTC (fazer as duas coisas desliga o dev no meio do expediente).
#
# Cobertura do fim de semana: o stop de SEX 20:00 vale até o start de SEG 08:00 — sábado e
# domingo não têm start, então nada religa. Não é preciso um schedule de fim de semana.
variable "cron_stop" {
  description = "Cron (em var.timezone) do desligamento — fim do expediente"
  type        = string
  default     = "cron(0 20 ? * MON-FRI *)" # 20:00, seg-sex
}

variable "cron_start" {
  description = "Cron (em var.timezone) do religamento — início do expediente"
  type        = string
  default     = "cron(0 8 ? * MON-FRI *)" # 08:00, seg-sex
}
