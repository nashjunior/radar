# Contrato do módulo `storage` — provider-agnóstico (A08 §4/§6, RAD-181).
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
  description = "Handle da chave de cifra em repouso (LGPD 13.709/2018). AWS: KMS key ARN"
  type        = string
}

variable "region" {
  description = "Região do provedor (usada no ARN/condição do Bedrock batch). AWS: região AWS"
  type        = string
}

# JSONL de entrada/saída do batch inference do Bedrock (P-92/RAD-231/RAD-236) — dado de
# terceiro (recorte de edital), não classe crítica (docs/05 §9). Job tem SLA de 24h; sem
# valor depois que o adapter (RAD-232) consome a saída. P-30/P-44 não fixam um número para
# este artefato transiente (regem o anexo/documento, não o JSONL de trabalho do batch).
variable "batch_lifecycle_expiration_days" {
  description = "Dias até expirar objetos de batch/ (JSONL de I/O do Bedrock batch, P-92)"
  type        = number
  default     = 30
  validation {
    condition     = var.batch_lifecycle_expiration_days >= 1
    error_message = "batch_lifecycle_expiration_days deve ser >= 1."
  }
}
