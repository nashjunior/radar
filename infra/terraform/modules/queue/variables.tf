# Contrato do módulo `queue` — provider-agnóstico (A08 §4/§6, RAD-181).
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

variable "queue_name" {
  description = "Nome lógico da fila (ex.: editais-ingeridos)"
  type        = string
}

variable "encryption_key_ref" {
  description = "Handle da chave de cifra em repouso (LGPD 13.709/2018). AWS: KMS key ARN"
  type        = string
}

variable "visibility_timeout" {
  description = "Timeout de visibilidade (s) — deve exceder o tempo de processamento máximo"
  type        = number
  default     = 30
}

variable "max_receive_count" {
  description = "Tentativas antes de mover a mensagem para a DLQ"
  type        = number
  default     = 5
}
