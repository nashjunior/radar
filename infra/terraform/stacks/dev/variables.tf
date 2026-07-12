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
  default     = "radar-dev"
}

variable "cognito_callback_urls" {
  description = "URLs de callback OAuth cadastradas no app client Cognito"
  type        = list(string)
  default     = ["http://localhost:5173/auth/callback"]
}

variable "cognito_logout_urls" {
  description = "URLs de logout cadastradas no app client Cognito"
  type        = list(string)
  default     = ["http://localhost:5173/login"]
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

# true em dev: onde o rate-limit/CAPTCHA do RAD-273 deixa de ser inerte e o onboarding
# pós-login é testado ponta a ponta (RAD-283/RAD-284).
variable "cognito_permitir_auto_cadastro" {
  description = "Habilita self-service signup no Hosted UI (P-109 L2). dev = true."
  type        = bool
  default     = true
}

variable "enable_serverless_workers" {
  description = "Extrai os workers p/ o tier Lambda (seam P-27). false = coabitam apps/api (P-96)."
  type        = bool
  default     = false
}


# --- Tier sempre-ligado (RAD-199) ------------------------------------------------------

variable "api_image_tag" {
  description = "Tag da imagem do tier sempre-ligado (repositório MUTABLE aqui: re-push da mesma tag é permitido)"
  type        = string
  default     = "latest"
}

variable "tls_certificate_arn" {
  description = "Certificado TLS da borda. Nulo = borda em HTTP puro — aceitável fora de prod, onde a precondition do módulo `edge` barra."
  type        = string
  default     = null
}

variable "api_cors_origins" {
  description = "Origens permitidas pelo CORS da API (RAD-160). Vazio = nenhuma origem cruzada aceita (fail-closed)."
  type        = list(string)
  default     = ["http://localhost:5173"]
}
