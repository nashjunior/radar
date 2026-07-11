# Contrato do módulo `secrets` — provider-agnóstico (A08 §4/§6, RAD-181).
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

variable "encryption_key_ref" {
  description = "Handle da chave de cifra dos segredos em repouso (LGPD 13.709/2018). AWS: KMS key ARN"
  type        = string
}
