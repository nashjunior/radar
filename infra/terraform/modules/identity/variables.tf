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

variable "hosted_ui_domain_prefix" {
  description = "Prefixo do domínio Hosted/Managed Login (radar-<env>). Único por região AWS."
  type        = string
}

variable "callback_urls" {
  description = "URLs de callback OAuth (redirect_uri do SPA após login)"
  type        = list(string)
  validation {
    condition     = length(var.callback_urls) > 0
    error_message = "informe ao menos uma callback_url."
  }
}

variable "logout_urls" {
  description = "URLs de logout (retorno do endpoint de logout da Hosted UI)"
  type        = list(string)
  validation {
    condition     = length(var.logout_urls) > 0
    error_message = "informe ao menos uma logout_url."
  }
}

variable "advanced_security_mode" {
  description = "Cognito Advanced Security (adaptive auth / brute-force): ENFORCED | AUDIT | OFF"
  type        = string
  default     = "ENFORCED"
  validation {
    condition     = contains(["ENFORCED", "AUDIT", "OFF"], var.advanced_security_mode)
    error_message = "advanced_security_mode deve ser ENFORCED, AUDIT ou OFF."
  }
}

variable "id_token_validity_minutes" {
  description = "TTL do ID token em minutos (curto; a borda valida o ID token)"
  type        = number
  default     = 15
}

variable "access_token_validity_minutes" {
  description = "TTL do access token em minutos (curto)"
  type        = number
  default     = 15
}

variable "refresh_token_validity_days" {
  description = "Janela do refresh token em dias (limitada; com rotação + revogação)"
  type        = number
  default     = 7
}
