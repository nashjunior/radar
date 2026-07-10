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

variable "vpc_id" {
  description = "ID da VPC onde o banco será provisionado"
  type        = string
}

variable "vpc_cidr" {
  description = "CIDR da VPC para regra de ingress"
  type        = string
}

variable "subnet_ids" {
  description = "Subnets privadas para o subnet group"
  type        = list(string)
}

variable "db_name" {
  description = "Nome do banco de dados inicial"
  type        = string
  default     = "radar"
}

variable "db_username" {
  description = "Usuário master do banco (não use root)"
  type        = string
  sensitive   = true
}

variable "db_password" {
  description = "Senha master — use AWS Secrets Manager em prod"
  type        = string
  sensitive   = true
}

variable "kms_key_arn" {
  description = "ARN da chave KMS para criptografia em repouso (LGPD 13.709/2018)"
  type        = string
}

variable "max_connections" {
  description = "max_connections do Postgres (P-41: teto modesto; pools do proxy somam < isto)"
  type        = number
  default     = 200
  validation {
    condition     = var.max_connections >= 100 && var.max_connections <= 5000
    error_message = "max_connections deve estar entre 100 e 5000 (P-41 parte de 200)."
  }
}

variable "statement_timeout_ms" {
  description = "statement_timeout GLOBAL (ms) — backstop; pisos por pool via ALTER ROLE (P-41)"
  type        = number
  default     = 300000
}

variable "lock_timeout_ms" {
  description = "lock_timeout GLOBAL (ms) — 0=espera indefinida; 3 s só nos pools quentes por role (P-41)"
  type        = number
  default     = 0
}
