variable "aws_region" {
  description = "Região AWS — residência de dados (P-28, LGPD 13.709/2018)"
  type        = string
  default     = "sa-east-1"
}

variable "db_username" {
  type      = string
  sensitive = true
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "kms_key_arn" {
  description = "ARN da chave KMS para criptografia (LGPD 13.709/2018)"
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Prefixo unico do dominio Hosted/Managed Login do Cognito"
  type        = string
}

variable "cognito_callback_urls" {
  description = "URLs de callback OAuth cadastradas no app client Cognito"
  type        = list(string)
}

variable "cognito_logout_urls" {
  description = "URLs de logout cadastradas no app client Cognito"
  type        = list(string)
}

variable "cognito_advanced_security_mode" {
  description = "Cognito Advanced Security/adaptive auth: ENFORCED | AUDIT | OFF"
  type        = string
  default     = "ENFORCED"
  validation {
    condition     = contains(["ENFORCED", "AUDIT", "OFF"], var.cognito_advanced_security_mode)
    error_message = "cognito_advanced_security_mode deve ser ENFORCED, AUDIT ou OFF."
  }
}

variable "enable_serverless_workers" {
  description = "Extrai os workers p/ o tier Lambda (seam P-27). false = coabitam apps/api (P-96)."
  type        = bool
  default     = false
}

variable "ops_alarm_sns_topic_arn" {
  description = "SNS de destino dos alarmes de infra (ex.: pin de conexão do RDS Proxy). Vazio = sem ação."
  type        = string
  default     = ""
}
