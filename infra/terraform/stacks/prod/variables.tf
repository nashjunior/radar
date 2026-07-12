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
  description = "ARN da chave KMS para criptografia (LGPD 13.709/2018). Passado aos módulos como encryption_key_ref."
  type        = string
}

variable "cognito_domain_prefix" {
  description = "Prefixo único do domínio Hosted/Managed Login do Cognito"
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

# true em prod: gate cumprido (RAD-288). ProvisionarOrganizacaoUseCase + resolução por `sub`
# na borda (RAD-285) e o bulkhead L1 do coorte trial (RAD-271) existem; RAD-286 (onboarding
# no front) também fechou. custom:tenantId segue imutável e fora de write_attributes
# (guardrail AB1/P-51 — não renegociável por este flip).
variable "cognito_permitir_auto_cadastro" {
  description = "Habilita self-service signup no Hosted UI (P-109 L2). prod = true (RAD-288)."
  type        = bool
  default     = true
}

variable "enable_serverless_workers" {
  description = "Extrai os workers p/ o tier Lambda (seam P-27). false = coabitam apps/api (P-96)."
  type        = bool
  default     = false
}

variable "ops_alarm_sns_topic_arn" {
  description = "SNS de destino dos alarmes de infra (ex.: pin de conexão do RDS Proxy). Passado como alarm_topic_ref."
  type        = string
  default     = ""
}

# --- Tier sempre-ligado (RAD-199) ------------------------------------------------------

# SEM default de propósito: em prod o repositório é IMMUTABLE e o deploy referencia o SHA do
# commit. `latest` como default convidaria a task def a apontar pra um ponteiro móvel.
variable "api_image_tag" {
  description = "Tag da imagem do tier sempre-ligado (CI publica taguada pelo SHA do commit)"
  type        = string
}

variable "tls_certificate_arn" {
  description = "Certificado TLS da borda. Obrigatório em prod (precondition no módulo `edge`) — depende de domínio+ACM, mesma frente de RAD-134."
  type        = string
  default     = null
}

variable "api_cors_origins" {
  description = "Origens permitidas pelo CORS da API (RAD-160). Vazio = nenhuma origem cruzada aceita (fail-closed)."
  type        = list(string)
  default     = []
}
