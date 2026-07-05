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
