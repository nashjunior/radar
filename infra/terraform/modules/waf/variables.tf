# Contrato do módulo `waf` — provider-agnóstico (A08 §4/§6, RAD-181).
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

variable "rate_limit_per_ip" {
  description = "Teto de requisições por IP na janela de 5 min (bulkhead grosso, ANTES da app). O teto POR TENANT é da aplicação — o tenant só existe após validar o JWT (P-08)."
  type        = number
  default     = 2000
  validation {
    condition     = var.rate_limit_per_ip >= 100
    error_message = "rate_limit_per_ip >= 100 (mínimo do WAFv2 para regra rate-based)."
  }
}
