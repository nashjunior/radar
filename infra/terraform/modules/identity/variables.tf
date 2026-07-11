# Contrato do módulo `identity` — A08 §4/§6, RAD-181.
# Binding hoje = Amazon Cognito. O que é OIDC-padrão (callback/logout URLs, TTLs de token)
# usa vocabulário portável. O que é Cognito-bound está documentado no README.md.

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

# Cognito-bound: prefixo do subdomínio da Hosted/Managed Login (único por região AWS).
# Em outro provedor (Auth0, Okta) isso seria o tenant slug ou custom domain.
variable "hosted_ui_domain_prefix" {
  description = "Prefixo do domínio Hosted/Managed Login (radar-<env>). Cognito-bound: único por região."
  type        = string
}

variable "callback_urls" {
  description = "URLs de callback OAuth (redirect_uri do SPA após login). OIDC-padrão."
  type        = list(string)
  validation {
    condition     = length(var.callback_urls) > 0
    error_message = "informe ao menos uma callback_url."
  }
}

variable "logout_urls" {
  description = "URLs de logout (retorno do endpoint de logout). OIDC-padrão."
  type        = list(string)
  validation {
    condition     = length(var.logout_urls) > 0
    error_message = "informe ao menos uma logout_url."
  }
}

# Cognito-bound: Advanced Security Mode. Em Auth0 = Attack Protection; em Okta = ThreatInsight.
# Custo extra por MAU no Cognito. Mantido exposto para que stacks não hardcodem "ENFORCED"
# em ambientes de menor risco (dev pode usar AUDIT).
variable "advanced_security_mode" {
  description = "Modo de segurança adaptativa (brute-force/credential-stuffing). Cognito-bound: ENFORCED | AUDIT | OFF"
  type        = string
  default     = "ENFORCED"
  validation {
    condition     = contains(["ENFORCED", "AUDIT", "OFF"], var.advanced_security_mode)
    error_message = "advanced_security_mode deve ser ENFORCED, AUDIT ou OFF."
  }
}

variable "id_token_validity_minutes" {
  description = "TTL do ID token em minutos. OIDC-padrão."
  type        = number
  default     = 15
}

variable "access_token_validity_minutes" {
  description = "TTL do access token em minutos. OIDC-padrão."
  type        = number
  default     = 15
}

variable "refresh_token_validity_days" {
  description = "Janela do refresh token em dias. OIDC-padrão."
  type        = number
  default     = 7
}
