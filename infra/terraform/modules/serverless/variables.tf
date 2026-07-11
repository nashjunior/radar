variable "project" {
  description = "Nome do projeto (prefixo de recursos)"
  type        = string
}

variable "env" {
  description = "Ambiente: dev | staging | prod"
  type        = string
  validation {
    condition     = contains(["dev", "staging", "prod"], var.env)
    error_message = "env deve ser dev, staging ou prod."
  }
}

variable "aws_region" {
  description = "Região AWS (condição kms:ViaService)"
  type        = string
}

variable "vpc_id" {
  description = "ID da VPC dos workers"
  type        = string
}

variable "subnet_ids" {
  description = "Subnets privadas dos workers"
  type        = list(string)
}

variable "proxy_security_group_id" {
  description = "SG do RDS Proxy — destino do egress 5432 dos workers"
  type        = string
}

variable "kms_key_arn" {
  description = "ARN da KMS que cifra os secrets (kms:Decrypt)"
  type        = string
}

variable "secret_arns" {
  description = "ARNs dos secrets que os workers leem (database-url, field-crypto-key, etc.)"
  type        = list(string)
}

variable "database_url_secret_arn" {
  description = "ARN do secret DATABASE_URL (HOST = endpoint do proxy do pool)"
  type        = string
}

variable "lambda_package_path" {
  description = "Caminho do artefato Lambda (placeholder até a extração do seam P-27)"
  type        = string
  default     = "PLACEHOLDER-seam-p27-nao-empacotado.zip"
}

variable "enabled" {
  description = "Habilita o event source mapping SQS→Lambda (false = seam provisionado mas parado)"
  type        = bool
  default     = false
}

# Workers e seus TETOS de concorrência (P-41). Cada função mapeia a um pool do proxy;
# reserved_concurrency ≈ backends do pool (Ingestão 15 / Matching 10 / Notificação parte
# do interativo). A validação abaixo é o gate "soma dos tetos < max_connections".
variable "functions" {
  description = "Mapa função→config. reserved_concurrency é o teto de conexões ao banco."
  type = map(object({
    handler              = string
    runtime              = optional(string, "nodejs20.x")
    reserved_concurrency = number
    memory_size          = optional(number, 512)
    timeout              = optional(number, 60)
    pool                 = string           # pool do proxy que esta função consome
    proxy_endpoint       = string           # endpoint do RDS Proxy desse pool
    queue_arn            = optional(string) # SQS-driven; null = agendada (ingestão/health)
    batch_size           = optional(number, 10)
    schedule_expression  = optional(string, "rate(1 hour)") # só p/ agendadas (queue_arn=null)
  }))
  # SQS→Lambda: maximum_concurrency tem mínimo 2 na AWS; agendadas aceitam 1.
  validation {
    condition = alltrue([
      for _, f in var.functions :
      f.reserved_concurrency <= 1000 && f.reserved_concurrency >= (f.queue_arn == null ? 1 : 2)
    ])
    error_message = "reserved_concurrency: agendada >= 1; dirigida por SQS >= 2 (mínimo do maximum_concurrency); máx 1000."
  }
  # Gate P-41: soma dos tetos < max_connections com folga de admin.
  validation {
    condition     = sum([for _, f in var.functions : f.reserved_concurrency]) <= var.max_total_reserved_concurrency
    error_message = "Soma dos reserved_concurrency excede o teto (P-41: soma dos pools < max_connections com folga)."
  }
}

variable "max_total_reserved_concurrency" {
  description = "Teto da soma dos reserved_concurrency (folga sobre os backends do proxy; P-41)"
  type        = number
  default     = 40
}
