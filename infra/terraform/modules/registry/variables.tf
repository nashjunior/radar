# Contrato do módulo `registry` — provider-agnóstico (A08 §4/§6, RAD-181).
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

variable "repository_name" {
  description = "Nome do repositório de imagens (ex.: api)"
  type        = string
}

variable "encryption_key_ref" {
  description = "Handle da chave de cifra das camadas da imagem. AWS: KMS key ARN"
  type        = string
}

variable "image_tag_mutability" {
  description = "IMMUTABLE = a tag nunca é reescrita (prod: a task def vira referência auditável). MUTABLE = re-push da mesma tag (dev/staging)."
  type        = string
  default     = "IMMUTABLE"
  validation {
    condition     = contains(["IMMUTABLE", "MUTABLE"], var.image_tag_mutability)
    error_message = "image_tag_mutability deve ser IMMUTABLE ou MUTABLE."
  }
}

variable "untagged_retention_days" {
  description = "Dias até expirar imagem sem tag (camada órfã = custo puro)"
  type        = number
  default     = 7
}

variable "tagged_image_count" {
  description = "Quantas imagens tagueadas manter — é a janela de rollback, não um limite de custo"
  type        = number
  default     = 20
}
