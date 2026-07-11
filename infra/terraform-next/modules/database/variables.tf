# Contrato do módulo `database` — provider-agnóstico (A08 §4/§6, RAD-181).
# Ver README.md para o que aqui é irredutivelmente provider-bound.

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

variable "network_id" {
  description = "ID da rede privada onde o banco roda. AWS: VPC id"
  type        = string
}

variable "private_subnet_ids" {
  description = "Sub-redes privadas do banco (sem IP público). AWS: subnet ids"
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
  description = "Senha master — vem de secret gerenciado em prod (nunca hardcoded, docs/05 §4)"
  type        = string
  sensitive   = true
}

variable "encryption_key_ref" {
  description = "Handle da chave de cifra em repouso (LGPD 13.709/2018). AWS: KMS key ARN"
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
