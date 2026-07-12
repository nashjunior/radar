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

variable "asaas_webhook_path" {
  description = "Path restrito à allowlist de IP do Asaas (P-107(a)) — nunca `/api/*` nem `/health`."
  type        = string
  default     = "/webhooks/pagamento"
}

variable "asaas_webhook_ip_allowlist" {
  description = "IPs oficiais de produção do Asaas que originam POST de webhook — compensação obrigatória do aceite P-107(a)/RAD-253 (o Asaas autentica por token estático, não por HMAC no raw body). Fonte: docs.asaas.com/docs/ips-oficiais-do-asaas (lista atualizada em 2024-10-23). Sandbox pode ter IPs adicionais [A VALIDAR] — se o ambiente usar conta sandbox do Asaas, sobrescreva esta lista."
  type        = list(string)
  default = [
    "52.67.12.206/32",
    "18.230.8.159/32",
    "54.94.136.112/32",
    "54.94.183.101/32",
  ]
}

# --- RAD-252: rate-limit próprio + corpo pequeno do webhook de pagamento --------------
#
# Complementam a allowlist de IP acima (RAD-258) no MESMO path — o webhook é tráfego
# servidor-a-servidor (poucos IPs conhecidos, sem navegador, sem anexo/upload), então merece
# teto e limite de corpo PRÓPRIOS, mais apertados que os gerais da API inteira (P-107 (5)).

variable "asaas_webhook_rate_limit" {
  description = "Teto de requisições ao webhook de pagamento na janela de 5 min — PRÓPRIO, distinto de `rate_limit_per_ip` (regra geral da API inteira): tráfego server-to-server de poucos IPs (a allowlist de `asaas_webhook_ip_allowlist`), não navegador."
  type        = number
  default     = 500
  validation {
    condition     = var.asaas_webhook_rate_limit >= 100
    error_message = "asaas_webhook_rate_limit >= 100 (mínimo do WAFv2 para regra rate-based)."
  }
}

variable "asaas_webhook_max_body_bytes" {
  description = "Teto de corpo do webhook de pagamento — notificação server-to-server do Asaas é pequena por natureza (P-107 (5): 'corpo pequeno, é server-to-server'); acima disso é anomalia de payload, não notificação legítima."
  type        = number
  default     = 8192
}
